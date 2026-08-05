/* ============================================================
   SCENE SETUP
============================================================ */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 6.2, 9.8);
camera.lookAt(0, 0.2, 0.6);

/* lights */
scene.add(new THREE.HemisphereLight(0xfff6e8, 0xfbccd4, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d9, 0.9);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;   sun.shadow.camera.bottom = -8;
scene.add(sun);

/* ---------- toon shading setup ----------
   A tiny 3-step gradient map makes MeshToonMaterial shade in flat
   cel bands instead of smooth falloff. */
const toonSteps = new Uint8Array([90, 170, 255]);
const gradientMap = new THREE.DataTexture(toonSteps, toonSteps.length, 1, THREE.LuminanceFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

function toonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

/* ground - pastel pink meadow */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48),
  toonMat(0xfbccd4)
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ============================================================
   PROCEDURAL DUCK
   Built from primitives so it works with zero assets.
   When you have your Blender GLB: keep everything in
   updateDuck() (movement, heading, eye targets) and replace
   the geometry + waddle code with AnimationMixer clips.
============================================================ */
const duck = new THREE.Group();
// spawn in the empty lower-center of the hero (the text above is now
// centered) instead of dead-center - it won't move from here until the
// user's mouse actually does something, since hasMouse starts false
duck.position.set(1.89, 0, 4.32);
scene.add(duck);

const yellow = toonMat(0xffd44d);
const orange = toonMat(0xff8a5c);
const white  = toonMat(0xffffff);
const black  = new THREE.MeshBasicMaterial({ color: 0x2b3350 }); // flat ink pupils

/* body */
const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 28, 22), yellow);
body.scale.set(1, 0.85, 1.15);
const bodyBaseScale = body.scale.clone();
body.position.y = 0.95;
body.castShadow = true;
duck.add(body);

/* tail tuft */
const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 14), yellow);
tail.position.set(0, 1.25, -0.95);
tail.rotation.x = -Math.PI / 3;
tail.castShadow = true;
duck.add(tail);

/* head pivot - so head + eyes can aim at the cursor */
const headPivot = new THREE.Group();
headPivot.position.set(0, 1.75, 0.55);
duck.add(headPivot);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 26, 20), yellow);
head.position.set(0, 0.3, 0.1);
head.castShadow = true;
headPivot.add(head);

/* beak */
const beak = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 4), orange);
beak.scale.set(1.5, 1, 0.7);
beak.rotation.x = Math.PI / 2;
beak.position.set(0, 0.22, 0.62);
headPivot.add(beak);

/* eyes: white + pupil, pupils get nudged toward the cursor */
function makeEye(side) {
  const eye = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), white);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), black);
  pupil.position.z = 0.09;
  eye.add(ball, pupil);
  eye.position.set(0.24 * side, 0.42, 0.38);
  eye.rotation.y = 0.35 * side;
  headPivot.add(eye);
  return { eye, pupil, lid: ball };
}
const eyeL = makeEye(-1);
const eyeR = makeEye(1);

/* wings */
function makeWing(side) {
  const wing = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), yellow);
  wing.scale.set(0.35, 0.6, 1);
  wing.position.set(0.8 * side, 1.05, -0.1);
  wing.rotation.z = -0.25 * side;
  wing.castShadow = true;
  duck.add(wing);
  return wing;
}
const wingL = makeWing(-1);
const wingR = makeWing(1);

/* legs with webbed feet - pivot at the hip for the waddle swing */
function makeLeg(side) {
  const hip = new THREE.Group();
  hip.position.set(0.32 * side, 0.55, 0);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.55, 10), orange);
  leg.position.y = -0.27;
  const foot = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 3), orange);
  foot.scale.set(1.3, 0.25, 1);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(0, -0.55, 0.12);
  hip.add(leg, foot);
  leg.castShadow = true;
  duck.add(hip);
  return hip;
}
const legL = makeLeg(-1);
const legR = makeLeg(1);

/* ============================================================
   MOUSE → WORLD TARGET (raycast onto the ground plane)
============================================================ */
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNDC = new THREE.Vector2(0.3, 0.1);
const mouseRay = new THREE.Ray(new THREE.Vector3(0, 5, 10), new THREE.Vector3(0, -0.5, -1).normalize());
// default idle spot, before any mouse movement: lower-center of the
// screen, clear of the now-centered hero text above it
const target = new THREE.Vector3(1.89, 0, 4.32);
let hasMouse = false;
let usingScrollTarget = false; // true while the duck is jogging toward a page-transition spot

function clampToMeadow(v) {
  const r = v.length();
  if (r > 11) v.multiplyScalar(11 / r);
  return v;
}

// cast a ray from a normalized screen point (0..1 across, 0..1 down) onto the
// ground plane - used for both the mouse target and the "free space" spot
// next to each page's card when scrolling between pages.
// `atPageIndex`, if given, temporarily poses the camera at that page's
// *settled* drift position first - the parallax camera keeps pulling back
// as you move through pages, so raycasting with whatever transient camera
// pose exists mid-scroll would land the point at the wrong spot once the
// camera finishes settling on the destination page.
function screenPointToGround(fracX, fracY, out, atPageIndex) {
  let origY, origZ;
  if (atPageIndex != null) {
    origY = camera.position.y;
    origZ = camera.position.z;
    camera.position.y = 6.2 + atPageIndex * 1.8;
    camera.position.z = 9.8 + atPageIndex * 1.6;
    camera.lookAt(0, 0.2, 0.6);
    camera.updateMatrixWorld(true);
  }
  const ndc = new THREE.Vector2(fracX * 2 - 1, -(fracY * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  const result = raycaster.ray.intersectPlane(groundPlane, out) ? clampToMeadow(out) : null;
  if (atPageIndex != null) {
    camera.position.y = origY;
    camera.position.z = origZ;
    camera.lookAt(0, 0.2, 0.6);
    camera.updateMatrixWorld(true);
  }
  return result;
}

function updateTarget(clientX, clientY) {
  mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  mouseRay.copy(raycaster.ray);
  // while the duck is jogging to a scroll-triggered spot, leave `target`
  // alone - the head/eyes still track the cursor via mouseRay above, but
  // even a 1-2px pointer jitter (very easy to trigger mid-scroll, e.g. from
  // a trackpad gesture) used to redirect `target` to wherever the mouse was
  // - often still over the card - derailing the jog before it reached the
  // free space. It resumes reacting to the mouse once the duck arrives
  // (usingScrollTarget clears itself in updateDuck) or the next page starts
  // a fresh jog.
  if (usingScrollTarget) return;
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    target.copy(clampToMeadow(hit));
    hasMouse = true;
  }
}
window.addEventListener('pointermove', (e) => updateTarget(e.clientX, e.clientY));
window.addEventListener('touchmove', (e) => {
  if (e.touches[0]) updateTarget(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

/* ---------- click/tap the duck → it hops ---------- */
let jumpVel = 0;
let jumpY = 0;
const JUMP_SPEED = 5.2;
const GRAVITY = 16;

function tryJump(clientX, clientY) {
  // only from the ground, so clicks don't stack into an ever-higher jump
  if (jumpY > 0.001) return;
  mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(duck, true);
  if (hits.length) jumpVel = JUMP_SPEED;
}
// listen on window, not the canvas: the page's own elements (main, sections)
// sit above the canvas and swallow clicks over "empty" ground before they'd
// ever reach it, so we hit-test from the raw click coordinates instead
window.addEventListener('click', (e) => tryJump(e.clientX, e.clientY));

/* ---------- page offsets, tracked so scroll math still works now that
   pages are content-height instead of a fixed 100vh/100vw each ---------- */
// mirrors <main>'s children order: hero, about, timeline, how-i-work, portfolio, cv, creative, footer.
const pageEls = Array.from(document.querySelector('main').children);
let pageOffsets = [];
function recomputePageOffsets() {
  pageOffsets = pageEls.map((el) => el.offsetTop);
}
recomputePageOffsets();
window.addEventListener('resize', recomputePageOffsets);
if (document.fonts) document.fonts.ready.then(recomputePageOffsets);

// continuous "page index" - 0 at the top of the hero, 1 at the top of
// about, etc., fractional while scrolling through a page's height -
// replaces the old scrollX/innerWidth math from the horizontal layout
function currentScrollIndex() {
  const y = window.scrollY;
  let idx = 0;
  for (let i = pageOffsets.length - 1; i >= 0; i--) {
    if (y >= pageOffsets[i] - 1) { idx = i; break; }
  }
  const start = pageOffsets[idx];
  const end = idx + 1 < pageOffsets.length ? pageOffsets[idx + 1] : start + pageEls[idx].offsetHeight;
  const span = Math.max(1, end - start);
  const frac = Math.min(1, Math.max(0, (y - start) / span));
  return idx + frac;
}

/* ---------- stronger snap for how-i-work and cv ----------
   the page's global scroll-snap-type is "proximity" (soft: only pulls in
   if you stop right near a boundary), so most sections can be left
   resting mid-page. These two get a firmer, mandatory-like pull: once
   scrolling settles and they're the nearest page, force-align to their
   exact top instead of leaving it to chance. */
const strongSnapEls = [document.getElementById('how-i-work'), document.getElementById('cv')];
let scrollSettleTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => {
    const el = pageEls[Math.round(currentScrollIndex())];
    if (!strongSnapEls.includes(el)) return;
    const targetY = el.offsetTop;
    if (Math.abs(window.scrollY - targetY) > 2) {
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    }
  }, 120);
}, { passive: true });

/* ---------- vertical page scroll → duck jogs into the open ground
   next to whichever page just came into view ---------- */
// null = don't redirect the duck (hero/footer have no side-offset card)
const SECTION_FREE_X = [null, null, null, 0.94, null, 0.94, 0.06, null];
const SCROLL_TARGET_Y = 0.62; // normalized screen fraction - open ground below the card
let lastSectionIndex = Math.round(currentScrollIndex());
const scrollHit = new THREE.Vector3();

window.addEventListener('scroll', () => {
  const idx = Math.round(currentScrollIndex());
  if (idx === lastSectionIndex) return;
  lastSectionIndex = idx;
  const frac = SECTION_FREE_X[idx];
  if (frac == null) return;
  const pt = screenPointToGround(frac, SCROLL_TARGET_Y, scrollHit, idx);
  if (pt) {
    target.copy(pt);
    hasMouse = true;
    usingScrollTarget = true;
  }
}, { passive: true });

/* ============================================================
   DUCK BRAIN - runs toward the cursor, waddles, blinks
============================================================ */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new THREE.Clock();
let heading = 0;          // current yaw
let speed = 0;            // current smoothed speed, drives the waddle
let phase = 0;            // leg cycle phase
let blinkTimer = 2 + Math.random() * 3;
let blink = 0;            // 0 = open, 1 = closed

const MAX_SPEED = 4.2;
const SCROLL_MAX_SPEED = 2.1; // slower jog when heading toward a scroll-triggered spot
const NEAR_RADIUS = 2.6;   // inside this: stand still and track with the head only
const SCROLL_ARRIVE_RADIUS = 0.6; // scroll-triggered spots use a tighter "arrived" radius so the duck actually walks all the way there

const tmp = new THREE.Vector3();
const headWorld = new THREE.Vector3();
const rayPoint = new THREE.Vector3();
const farAim = new THREE.Vector3();

function updateDuck(dt, t) {
  /* --- locomotion --- */
  tmp.copy(target).sub(duck.position);
  tmp.y = 0;
  const dist = tmp.length();

  // once the duck reaches a scroll-triggered spot, hand control back to the
  // normal cursor-chasing behaviour (and its full speed) - a much tighter
  // radius than the mouse's, so it actually walks all the way over instead
  // of stopping short near the middle of the page
  if (usingScrollTarget && dist < SCROLL_ARRIVE_RADIUS + 0.3) usingScrollTarget = false;

  // off the hero page, the duck holds its spot in the page's free space and
  // only turns its head to the cursor - except mid-transition, when it's
  // still allowed to jog over to the new page's free space
  const sectionIdx = Math.round(currentScrollIndex());
  const duckLocked = sectionIdx !== 0 && !usingScrollTarget;

  const nearRadius = usingScrollTarget ? SCROLL_ARRIVE_RADIUS : NEAR_RADIUS;

  // 0 = cursor is close (head-tracking mode), 1 = cursor is far (walking mode)
  const nearness = duckLocked ? 0 : THREE.MathUtils.clamp((dist - nearRadius) / 1.2, 0, 1);
  const closeness = 1 - nearness;

  // jogging to a page-transition spot is deliberately slower/calmer than
  // sprinting after the cursor
  const maxSpeed = usingScrollTarget ? SCROLL_MAX_SPEED : MAX_SPEED;

  let desiredSpeed = 0;
  if (!duckLocked && hasMouse && dist > nearRadius) {
    // farther away → run faster (up to maxSpeed)
    desiredSpeed = Math.min(maxSpeed, (dist - nearRadius) * 1.6);
  }
  speed += (desiredSpeed - speed) * Math.min(1, dt * 5);

  if (dist > 0.001) {
    const targetHeading = Math.atan2(tmp.x, tmp.z);
    // shortest-angle interpolation
    let dh = targetHeading - heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    // while walking the body steers toward the cursor; when the cursor is
    // close the body stays planted and only shuffles around if the target
    // goes beyond what the neck can reach
    const HEAD_YAW_MAX = 1.3;
    const overflow = Math.sign(dh) * Math.max(0, Math.abs(dh) - HEAD_YAW_MAX);
    heading += (dh * nearness + overflow * closeness) * Math.min(1, dt * 6);
  }
  duck.rotation.y = heading;

  if (speed > 0.01) {
    duck.position.x += Math.sin(heading) * speed * dt;
    duck.position.z += Math.cos(heading) * speed * dt;
  }

  /* --- waddle: driven by speed --- */
  const runFactor = speed / MAX_SPEED;          // 0..1
  phase += dt * (4 + speed * 4);
  const swing = Math.sin(phase);

  if (!reducedMotion) {
    legL.rotation.x = swing * 0.9 * runFactor;
    legR.rotation.x = -swing * 0.9 * runFactor;

    // body bounce + side-to-side roll (the waddle!)
    duck.position.y = Math.abs(Math.sin(phase)) * 0.14 * runFactor;
    duck.rotation.z = Math.sin(phase) * 0.09 * runFactor;

    // idle breathing when standing still
    body.scale.y = 0.85 + Math.sin(t * 2.2) * 0.012 * (1 - runFactor);

    // wings flap when sprinting
    const flap = runFactor > 0.65 ? Math.sin(phase * 2) * 0.5 * runFactor : 0;
    wingL.rotation.z = -0.25 + flap;
    wingR.rotation.z = 0.25 - flap;
  }

  /* --- click-to-jump: simple gravity hop layered on top of the waddle --- */
  if (jumpVel !== 0 || jumpY > 0) {
    jumpVel -= GRAVITY * dt;
    jumpY += jumpVel * dt;
    if (jumpY <= 0) { jumpY = 0; jumpVel = 0; }
    duck.position.y += jumpY;
    // stretch upward on the way up, squash down on landing - scaled off the
    // body's own base proportions so it keeps its egg shape, not a sphere
    const stretch = jumpVel > 0 ? THREE.MathUtils.clamp(jumpVel / JUMP_SPEED, 0, 1) : 0;
    const squash = jumpY < 0.05 && jumpVel < -3 ? 0.18 : 0;
    body.scale.y = bodyBaseScale.y * (1 + stretch * 0.26 - squash) + Math.sin(t * 2.2) * 0.012 * (1 - runFactor);
    const girth = 1 - stretch * 0.08 + squash * 0.12;
    body.scale.x = bodyBaseScale.x * girth;
    body.scale.z = bodyBaseScale.z * girth;
  } else {
    body.scale.x = bodyBaseScale.x;
    body.scale.z = bodyBaseScale.z;
  }

  /* --- head + eye tracking --- */
  // walking: casually glance at a point above the cursor's ground spot.
  // close: aim at the point on the mouse ray nearest the head - so a cursor
  // hovering above the duck makes it look UP instead of craning backwards.
  headPivot.getWorldPosition(headWorld);
  mouseRay.closestPointToPoint(headWorld, rayPoint);
  rayPoint.y = THREE.MathUtils.clamp(rayPoint.y, 0.15, 4.5);
  farAim.copy(target);
  farAim.y = 1.4;
  tmp.lerpVectors(rayPoint, farAim, nearness);
  headPivot.parent.worldToLocal(tmp);        // into duck-local space
  tmp.sub(headPivot.position);
  let yaw = Math.atan2(tmp.x, tmp.z);
  let pitch = Math.atan2(-tmp.y * (0.3 + 0.7 * closeness), Math.hypot(tmp.x, tmp.z));
  // clamp so the neck stays cute, not cursed - wider range when watching up
  // close, including upward pitch for cursors floating overhead
  const yawMax = 1.0 + 0.3 * closeness;
  yaw = THREE.MathUtils.clamp(yaw, -yawMax, yawMax);
  pitch = THREE.MathUtils.clamp(pitch, -(0.35 + 0.55 * closeness), 0.45 + 0.4 * closeness);
  // snappier tracking when the duck is standing and paying attention
  const track = Math.min(1, dt * (8 + 6 * closeness));
  headPivot.rotation.y += (yaw - headPivot.rotation.y) * track;
  headPivot.rotation.x += (pitch - headPivot.rotation.x) * track;
  // curious head tilt - gentle and lazy so it never jitters
  const tilt = THREE.MathUtils.clamp(headPivot.rotation.y, -0.8, 0.8) * 0.12 * closeness;
  headPivot.rotation.z += (tilt - headPivot.rotation.z) * Math.min(1, dt * 3.5);

  // pupils drift a little further than the head for extra life
  const px = THREE.MathUtils.clamp(yaw - headPivot.rotation.y, -0.5, 0.5);
  const py = THREE.MathUtils.clamp(pitch - headPivot.rotation.x, -0.4, 0.4);
  const pupilRange = 0.06 + 0.05 * closeness;
  eyeL.pupil.position.x = px * pupilRange;
  eyeR.pupil.position.x = px * pupilRange;
  eyeL.pupil.position.y = -py * 0.05 * closeness;
  eyeR.pupil.position.y = -py * 0.05 * closeness;

  /* --- blinking --- */
  blinkTimer -= dt;
  if (blinkTimer <= 0) { blinkTimer = 2 + Math.random() * 4; blink = 1; }
  if (blink > 0) blink = Math.max(0, blink - dt * 6);
  const lidScale = 1 - Math.sin(blink * Math.PI) * 0.85;
  eyeL.eye.scale.y = lidScale;
  eyeR.eye.scale.y = lidScale;
}

/* ============================================================
   RENDER LOOP
============================================================ */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateDuck(dt, t);

  // gentle camera drift + pull back slightly as you scroll
  const pageProgress = currentScrollIndex();
  camera.position.y = 6.2 + pageProgress * 1.8 + Math.sin(t * 0.4) * 0.08;
  camera.position.z = 9.8 + pageProgress * 1.6;
  camera.lookAt(0, 0.2, 0.6);

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================
   SCROLL REVEAL for sections
============================================================ */
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

/* ============================================================
   HOW-I-WORK CARDS - tap to open on touch devices, since :hover
   isn't reliable there
============================================================ */
document.querySelectorAll('#how-i-work .bubble').forEach((card) => {
  card.addEventListener('click', () => card.classList.toggle('is-open'));
});

/* ============================================================
   PORTFOLIO PROJECTS - "read more" unfolds the full story below the
   one-sentence summary, so the page reads at two levels
============================================================ */
document.querySelectorAll('#portfolio .project-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const project = btn.closest('.project');
    const isOpen = project.classList.toggle('is-open');
    btn.textContent = isOpen ? 'show less ↑' : 'read more ↓';
  });
});

/* ============================================================
   PAGE NAV - highlight whichever section is currently on screen,
   and swap the "go home" chick for a language switcher while on the
   hero page itself (going home from home wouldn't make sense)
============================================================ */
const pageNav = document.querySelector('.page-nav');
const pageNavLinks = document.querySelectorAll('.page-nav a[data-idx]');
const cvContact = document.querySelector('.cv-contact');
const cvArrowSvg = document.querySelector('.cv-arrow');
const cvArrowPath = document.querySelector('.cv-arrow-path');
const cvArrowTextPath = document.querySelector('.cv-arrow-text-path');
let cvArrowLength = 0;

// size the svg's viewBox to real pixel dimensions (1 unit = 1px) instead of
// a 0-100 "percentage" viewBox stretched non-uniformly to fill the section -
// that stretch, combined with vector-effect:non-scaling-stroke, made
// Chromium glitch the dash-draw animation into broken-looking segments
function layoutCvArrow() {
  if (!cvArrowSvg || !cvArrowPath) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  cvArrowSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // starts just past the card's right edge (card is 60vw wide, starting
  // 6vw in, so it ends ~66vw across) and sweeps up into a convex curve
  // (control points stay low, so the curve keeps rising all the way to
  // the end instead of cresting early and dipping back down) ending near
  // the linkedin/email icons (~94.5% across, ~8% down) rather than the
  // github one
  const d = `M ${0.68 * w} ${0.30 * h} C ${0.78 * w} ${0.32 * h}, ${0.90 * w} ${0.18 * h}, ${0.945 * w} ${0.08 * h}`;
  cvArrowPath.setAttribute('d', d);
  cvArrowLength = cvArrowPath.getTotalLength();
  // the caption text follows this second, unrendered path - a copy of the
  // arrow shifted 14px up - instead of the visible one, so it reads as
  // floating just above the line rather than sitting on top of it
  if (cvArrowTextPath) {
    const lift = 14;
    const dText = `M ${0.68 * w} ${0.30 * h - lift} C ${0.78 * w} ${0.32 * h - lift}, ${0.90 * w} ${0.18 * h - lift}, ${0.945 * w} ${0.08 * h - lift}`;
    cvArrowTextPath.setAttribute('d', dText);
  }
  const isVisible = cvContact && cvContact.classList.contains('visible');
  cvArrowPath.style.strokeDasharray = cvArrowLength;
  cvArrowPath.style.strokeDashoffset = isVisible ? 0 : cvArrowLength;
}
layoutCvArrow();
window.addEventListener('resize', layoutCvArrow);

function updatePageNav() {
  const idx = Math.round(currentScrollIndex());
  pageNav.classList.add('visible');
  pageNav.classList.toggle('on-hero', idx === 0);
  pageNavLinks.forEach((a) => {
    a.classList.toggle('active', Number(a.dataset.idx) === idx);
  });
  // cv page (idx 5): draw the "reach out" arrow toward the social icons
  if (cvContact) {
    const onCvPage = idx === 5;
    cvContact.classList.toggle('visible', onCvPage);
    if (cvArrowPath) cvArrowPath.style.strokeDashoffset = onCvPage ? 0 : cvArrowLength;
  }
}
window.addEventListener('scroll', updatePageNav, { passive: true });
updatePageNav();

/* ---------- "next section" button ----------
   mirrors pageEls' order: hero, about, timeline, how-i-work, portfolio,
   cv, creative, footer. entry i = title shown while ON section i (i.e.
   the title of section i+1); null hides the button (creative → footer
   has no real title, and footer has no next section at all). */
const NEXT_SECTION_TITLE = ['about me', 'timeline', 'how i work', 'portfolio', 'cv', 'other fun stuff', null, null];
const nextSectionBtn = document.getElementById('next-section-btn');
const nextSectionBtnTitle = nextSectionBtn.querySelector('.next-section-btn-title');

function updateNextSectionButton() {
  const idx = Math.round(currentScrollIndex());
  const title = NEXT_SECTION_TITLE[idx];
  if (title) {
    nextSectionBtnTitle.textContent = title;
    nextSectionBtn.classList.add('visible');
  } else {
    nextSectionBtn.classList.remove('visible');
  }
}
nextSectionBtn.addEventListener('click', () => {
  const idx = Math.round(currentScrollIndex());
  const nextEl = pageEls[idx + 1];
  if (nextEl) nextEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
window.addEventListener('scroll', updateNextSectionButton, { passive: true });
updateNextSectionButton();

/* ---------- language switcher ----------
   UI-only for now: it tracks the selected language (and updates the
   flag shown) but there's no actual translated content wired up yet -
   swap in real i18n strings later. */
const langSwitcher = document.querySelector('.lang-switcher');
const langBtn = document.querySelector('.lang-btn');
const langBtnImg = langBtn.querySelector('img');
langBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = langSwitcher.classList.toggle('open');
  langBtn.setAttribute('aria-expanded', String(isOpen));
});
document.querySelectorAll('.lang-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    langBtnImg.src = opt.dataset.flag;
    langSwitcher.classList.remove('open');
    langBtn.setAttribute('aria-expanded', 'false');
  });
});
document.addEventListener('click', (e) => {
  if (!langSwitcher.contains(e.target)) {
    langSwitcher.classList.remove('open');
    langBtn.setAttribute('aria-expanded', 'false');
  }
});

/* ============================================================
   BLINKING FAVICON - eyes open most of the time, closed for a
   quick beat, like a real blink rather than an even alternation
============================================================ */
const favicon = document.getElementById('favicon');
const EYES_OPEN = 'media/opened-duck.png';
const EYES_CLOSED = 'media/closed-duck.png';
function scheduleBlink() {
  setTimeout(() => {
    favicon.href = EYES_CLOSED;
    setTimeout(() => {
      favicon.href = EYES_OPEN;
      scheduleBlink();
    }, 180); // blink duration
  }, 1600 + Math.random() * 1800); // time between blinks
}
scheduleBlink();
