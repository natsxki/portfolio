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
  if (usingScrollTarget || introPending) return;
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
   scrolling settles close to one of their top edges, force-align to it
   instead of leaving it to chance.

   this used to key off Math.round(currentScrollIndex()), which rounds
   based on *fractional position within the current section's own
   height* - fine for normal single-screen sections, but #portfolio can
   be much taller than one viewport (many expandable projects), so
   crossing its own halfway point already rounded to cv's index and
   yanked the reader down mid-article. checking actual pixel distance to
   each target's top instead means it only fires near the real boundary. */
const strongSnapEls = [document.getElementById('how-i-work'), document.getElementById('cv')];
let scrollSettleTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => {
    for (const el of strongSnapEls) {
      const targetY = el.offsetTop;
      const dist = window.scrollY - targetY;
      if (Math.abs(dist) < window.innerHeight * 0.35) {
        if (Math.abs(dist) > 2) window.scrollTo({ top: targetY, behavior: 'smooth' });
        return;
      }
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

/* ---------- hero intro: duck peeks in from offscreen, pauses, then
   walks to the screen's true center before handing off to normal
   mouse-chasing. Both spots are raycast off the *current* window size
   (screenPointToGround already accounts for aspect ratio), so "center"
   lands on the real center of whatever viewport the visitor has - phone
   or desktop - rather than a fixed world coordinate. ---------- */
let introPending = true;
// 0.9 reproduces the depth of the duck's old hardcoded spawn point (z≈4.32,
// low on the screen clear of the hero text above) - the fracY=0.62 used
// elsewhere for post-scroll resting spots is tuned for those pages' more
// pulled-back, drifted camera and lands much farther away at the hero's
// undrifted camera, which (combined with the duck's head sitting well above
// the ground plane) threw it up near the top of the screen instead.
const HERO_REST_FRAC_Y = 0.9;
// this runs before the first animate() frame, so the camera's world matrix
// hasn't been computed yet (it's normally refreshed as a side effect of
// rendering) - force it now, or the raycasts below intersect the ground
// plane using a stale/identity matrix and land nowhere near the camera view
camera.updateMatrixWorld(true);
const heroRestSpot = screenPointToGround(0.5, HERO_REST_FRAC_Y, new THREE.Vector3());
// peek in from just past the left edge (only a sliver on-screen) - raycast
// (not a flat world offset) so it lands at the same "just barely in frame"
// spot regardless of viewport aspect, phone or desktop
const heroPeekSpot = screenPointToGround(-0.04, HERO_REST_FRAC_Y, new THREE.Vector3());
if (heroPeekSpot) {
  duck.position.copy(heroPeekSpot);
  heading = Math.PI / 2; // face right, toward the center it's about to walk into
  duck.rotation.y = heading;
}
setTimeout(() => {
  introPending = false;
  // skip if the visitor has already scrolled off the hero (or moved the
  // mouse there themselves) by the time the peek pause ends - otherwise
  // this would yank the duck back to the hero's center mid-jog to
  // wherever the page it scrolled to actually needed it
  if (heroRestSpot && Math.round(currentScrollIndex()) === 0 && !hasMouse) {
    target.copy(heroRestSpot);
    hasMouse = true;
    usingScrollTarget = true; // same calmer jog + tighter arrival radius as page-transition walks
  }
}, 900);

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
   HOW-I-WORK BUBBLES - cascade from a vertical stack (narrowest
   screens) into a diagonal, backslash-like spread (everything else),
   interpolated smoothly as the window resizes. Flex-wrap can only
   jump between "one row" and "one column" at a breakpoint; sliding
   continuously from a stack into a diagonal needs each bubble's
   position computed directly, so left/top are set here instead.
============================================================ */
const bubblesEl = document.querySelector('#how-i-work .bubbles');
const bubbleEls = bubblesEl ? Array.from(bubblesEl.querySelectorAll('.bubble')) : [];

function layoutBubbles() {
  if (!bubblesEl || !bubbleEls.length) return;
  const bubbleSize = bubbleEls[0].getBoundingClientRect().width || 170;
  // measured against the section's content width (bubbles' own parent),
  // not window.innerWidth directly, so the section's padding is already
  // accounted for
  const containerWidth = bubblesEl.parentElement.clientWidth;

  // below NARROW: a plain vertical stack, one per row. at/above WIDE: the
  // full diagonal cascade. in between, every bubble's x/y is linearly
  // interpolated between its stacked and spread position, so resizing
  // slides between the two arrangements instead of snapping at a
  // breakpoint.
  const NARROW = 420;
  const WIDE = 760;
  const t = Math.min(1, Math.max(0, (containerWidth - NARROW) / (WIDE - NARROW)));

  const gapStacked = 20;
  const stepXSpread = bubbleSize + 24;
  const stepYSpread = bubbleSize * 0.42;

  let maxBottom = 0;
  bubbleEls.forEach((el, i) => {
    const yStacked = i * (bubbleSize + gapStacked);
    const xSpread = i * stepXSpread;
    const ySpread = i * stepYSpread;
    const x = xSpread * t;
    const y = yStacked + (ySpread - yStacked) * t;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    maxBottom = Math.max(maxBottom, y + bubbleSize);
  });
  bubblesEl.style.height = `${maxBottom}px`;
}
layoutBubbles();
window.addEventListener('resize', layoutBubbles);

/* ============================================================
   PORTFOLIO PROJECTS - "read more" unfolds the full story below the
   one-sentence summary, so the page reads at two levels
============================================================ */
document.querySelectorAll('#portfolio .project-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const project = btn.closest('.project');
    const isOpen = project.classList.toggle('is-open');
    const dict = translations[currentLang] || {};
    btn.textContent = isOpen
      ? (dict['portfolio.showLess'] || 'hide thinking ↑')
      : (dict['portfolio.readMore'] || 'the thinking ↓');
  });
});

/* ============================================================
   PORTFOLIO IMAGE LIGHTBOX - click any project screenshot to see it
   bigger. One shared overlay reused for every image, rather than a
   modal built per-image.
============================================================ */
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxClose = lightbox.querySelector('.lightbox-close');
let lightboxReturnFocus = null;

function openLightboxCommon() {
  lightboxReturnFocus = document.activeElement;
  lightbox.classList.add('is-open');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  lightboxClose.focus();
}

function openLightboxImage(img) {
  lightboxVideo.pause();
  lightboxVideo.style.display = 'none';
  lightboxImg.style.display = '';
  lightboxImg.src = img.currentSrc || img.src;
  lightboxImg.alt = img.alt || '';
  openLightboxCommon();
}

function openLightboxVideo(video) {
  lightboxImg.style.display = 'none';
  lightboxVideo.style.display = 'block';
  lightboxVideo.src = video.currentSrc || video.src;
  lightboxVideo.currentTime = video.currentTime;
  openLightboxCommon();
  if (!video.paused) lightboxVideo.play();
}

function closeLightbox() {
  lightbox.classList.remove('is-open');
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lightboxVideo.pause();
  if (lightboxReturnFocus) lightboxReturnFocus.focus();
}

document.querySelectorAll('#portfolio .project-gallery-frame img').forEach((img) => {
  img.addEventListener('click', () => openLightboxImage(img));
});
document.querySelectorAll('#portfolio .project-video-expand').forEach((btn) => {
  btn.addEventListener('click', () => {
    const video = btn.closest('.project-video-frame').querySelector('video');
    if (video) openLightboxVideo(video);
  });
});
lightboxClose.addEventListener('click', closeLightbox);
// clicking the dark backdrop closes it too; clicking the image/video itself shouldn't
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('is-open')) closeLightbox();
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
const cvArrowText = document.querySelector('.cv-arrow-text');
let cvArrowLength = 0;

// size the svg's viewBox to real pixel dimensions (1 unit = 1px) instead of
// a 0-100 "percentage" viewBox stretched non-uniformly to fill the section -
// that stretch, combined with vector-effect:non-scaling-stroke, made
// Chromium glitch the dash-draw animation into broken-looking segments
const cvSection = document.getElementById('cv');
const cvCard = cvSection ? cvSection.querySelector('.card') : null;

function layoutCvArrow() {
  if (!cvArrowSvg || !cvArrowPath) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  cvArrowSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // the card's width is responsive (min(90vw, 880px)), so below ~977px
  // wide it's ~90vw regardless - leaving almost no gap between its right
  // edge and the screen edge. Starting the arrow there squeezes it into a
  // cramped near-vertical squiggle. So the start point itself migrates:
  // beside the card's right edge when there's real room for it, sliding
  // down to just below the card's bottom-right when there isn't - t is
  // driven by the actual measured gap, not a viewport-width guess.
  let startX = 0.68 * w;
  let startY = 0.30 * h;
  let c1x = startX + 0.10 * w;
  let c1y = startY + 0.02 * h;
  if (cvSection && cvCard) {
    const sectionRect = cvSection.getBoundingClientRect();
    const cardRect = cvCard.getBoundingClientRect();
    const cardLeft = cardRect.left - sectionRect.left;
    const cardTop = cardRect.top - sectionRect.top;

    const gapRight = w - cardRect.right; // actual room to the card's right, in real px
    const GAP_NARROW = 80;  // ~no room -> start fully below the card
    const GAP_WIDE = 260;   // comfortable room -> start fully beside the card
    const t = Math.min(1, Math.max(0, (gapRight - GAP_NARROW) / (GAP_WIDE - GAP_NARROW)));

    const besideX = cardLeft + cardRect.width + 0.025 * w;
    const besideY = cardTop + cardRect.height * 0.4;
    // not below the card: the end point sits near the very top of the
    // screen, so starting from below the card forced the curve to rise
    // back up *through* the card's own footprint to get there. Starting
    // from just above the card's top-right corner instead keeps the
    // whole line in the empty space above the card and needs far less
    // vertical travel to reach the icons from there.
    const aboveX = cardLeft + cardRect.width * 0.85;
    const aboveY = cardTop - 10;

    startX = aboveX + (besideX - aboveX) * t;
    startY = aboveY + (besideY - aboveY) * t;
    // beside the card, the curve immediately sweeps rightward; above the
    // card, it's already heading the right way, so the pull just
    // continues that rise instead of redirecting
    const c1xBeside = besideX + 0.10 * w;
    const c1yBeside = besideY + 0.02 * h;
    const c1xAbove = aboveX + 0.08 * w;
    const c1yAbove = aboveY - 0.05 * h;
    c1x = c1xAbove + (c1xBeside - c1xAbove) * t;
    c1y = c1yAbove + (c1yBeside - c1yAbove) * t;
  }
  // sweeps up into a convex curve, ending near the linkedin/email icons
  // (~94.5% across, ~8% down) rather than the github one - those stay
  // viewport fractions since the icons are position:fixed, not part of
  // the card
  const c2x = 0.90 * w, c2y = 0.18 * h;
  const endX = 0.945 * w, endY = 0.08 * h;
  const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;
  cvArrowPath.setAttribute('d', d);
  cvArrowLength = cvArrowPath.getTotalLength();
  // the caption text follows this second, unrendered path - a copy of the
  // arrow shifted 14px up - instead of the visible one, so it reads as
  // floating just above the line rather than sitting on top of it
  if (cvArrowTextPath) {
    const lift = 14;
    // trimmed to the first ~85% of the curve (via De Casteljau subdivision,
    // so the shortened curve still matches the original's shape exactly
    // rather than just aiming at a nearby point) - a modest safety margin
    // so the path itself never runs all the way into the icon
    const trim = 0.85;
    const p0 = { x: startX, y: startY - lift };
    const p1 = { x: c1x, y: c1y - lift };
    const p2 = { x: c2x, y: c2y - lift };
    const p3 = { x: endX, y: endY - lift };
    const lerp = (a, b, s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
    const a = lerp(p0, p1, trim);
    const b = lerp(p1, p2, trim);
    const c = lerp(p2, p3, trim);
    const d2 = lerp(a, b, trim);
    const e = lerp(b, c, trim);
    const f = lerp(d2, e, trim);
    const dText = `M ${p0.x} ${p0.y} C ${a.x} ${a.y}, ${d2.x} ${d2.y}, ${f.x} ${f.y}`;
    cvArrowTextPath.setAttribute('d', dText);

    // the real guarantee against hiding behind the icon: measure the
    // caption's actual on-screen box against the mail icon's and shrink the
    // font until they clear. Arc length isn't a reliable stand-in for this -
    // the curve moves mostly *vertically* near its end, so trimming arc
    // length off the tail barely pulls the text's rightmost pixel back at
    // all. Checking real getBoundingClientRect overlap sidesteps that
    // entirely, and re-measuring after each shrink handles the curve's
    // uneven speed without needing to model it.
    const mailIcon = document.querySelector('.social-item .icon-btn');
    if (cvArrowText && mailIcon) {
      cvArrowText.style.fontSize = '';
      cvArrowText.style.opacity = '';
      const naturalSize = parseFloat(getComputedStyle(cvArrowText).fontSize);
      const minSize = naturalSize * 0.8; // stay legible - don't shrink past this
      const safetyGap = 4;
      let size = naturalSize;
      for (let i = 0; i < 6; i++) {
        const textRect = cvArrowText.getBoundingClientRect();
        const mailRect = mailIcon.getBoundingClientRect();
        const overlap = textRect.right - (mailRect.left - safetyGap);
        if (overlap <= 0 || size <= minSize) break;
        const ratio = Math.max(0.85, 1 - (overlap / textRect.width) * 0.7);
        size = Math.max(minSize, size * ratio);
        cvArrowText.style.fontSize = `${size}px`;
      }
      // some window sizes are too cramped to fit the caption at all, even
      // at the smallest legible size - hide it rather than let it run
      // behind the icon; the line itself still points there without it
      const finalRect = cvArrowText.getBoundingClientRect();
      const mailRect = mailIcon.getBoundingClientRect();
      if (finalRect.right > mailRect.left - safetyGap) {
        cvArrowText.style.opacity = '0';
      }
    }
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
const NEXT_SECTION_TITLE = ['about me', 'timeline', 'how i work', 'portfolio', 'resume', 'other fun stuff', null, null];
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

/* ---------- language switcher / i18n ----------
   every translatable element carries data-i18n="key" (plus
   data-i18n-attr="attrName" when the target is an attribute rather than
   the element's content). English is never stored in the dictionary -
   it's just whatever's already sitting in the HTML - so switching back
   to English means restoring the snapshot taken here at load time.
   French is fully translated; Japanese/German are flag-only stubs
   until someone writes those dictionaries. */
const translations = {
  fr: {
    'social.nav': "contacts",
    'social.email': "m'envoyer un email",
    'nav.pageNav': "navigation",
    'nav.home': "accueil",
    'nav.chooseLanguage': "langues",
    'nav.about': "À propos",
    'nav.howIWork': "Ma façon de travailler",
    'nav.portfolio': "Portfolio",
    'nav.cv': "CV",
    'nav.creative': "Autres projets créatifs",
    'nav.nextSection': "section suivante",

    'hero.hello': "langues · systèmes · interfaces",
    'hero.h1': "Hello, moi c'est Lylia !",
    'hero.scrollHint': "En savoir plus sur moi :) ↓",

    'about.h2': "Enchantée !",
    'about.intro': "J'ai grandi entre le français et le japonais, avec l'allemand et l'anglais en plus : quatre langues, mais surtout quatre manières de poser un même problème. C'est ce passage constant d'un cadre à l'autre qui m'a donné le goût de la traduction au sens large : pas entre les mots, mais entre les disciplines. Ingénierie, design, stratégie ; e qui me passionne, c'est de faire le lien entre les trois : prendre ce qu'un designer voit, ce qu'un ingénieur sait construire et ce qu'une roadmap exige, et en faire une décision commune sur laquelle toute une équipe peut avancer. C'est exactement là que j'ai envie d'être !",
    'about.status': 'Actuellement stagiaire en développement logiciel chez ArianeGroup, je recherche un <strong>stage de Product Manager</strong> entre mars et août 2027.',

    'timeline.h2': "Parcours",
    'timeline.academics': "Études",
    'timeline.professional': "Expérience professionnelle",
    'timeline.msc': "Diplôme d'ingénieur, <a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a> (<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>). <br><br>Majeures : Data Science & IA + Graphisme 3D & Interactions (IHM)",
    'timeline.arianegroup.company': "<a href=\"https://www.ariane.group/\" target=\"_blank\" rel=\"noopener\">ArianeGroup</a>",
    'timeline.arianegroup.role': "Stagiaire en développement logiciel",
    'timeline.dataannotation.company': "<a href=\"https://www.dataannotation.tech\" target=\"_blank\" rel=\"noopener\">DataAnnotation</a>",
    'timeline.dataannotation.role': "Évaluatrice de modèles IA (temps partiel)",
    'timeline.ey.company': "<a href=\"https://www.ey.com/fr_fr\" target=\"_blank\" rel=\"noopener\">EY</a>",
    'timeline.ey.role': "Stagiaire en conseil stratégie &amp; tech",
    'timeline.joc.company': "<a href=\"https://www.joc.or.jp/english/\" target=\"_blank\" rel=\"noopener\">Comité Olympique Japonais</a>",
    'timeline.joc.role': "Assistante du Président",

    'how.h2': "Ma façon de travailler",
    'how.b1.title': "Lancer ou ne pas lancer",
    'how.b1.detail': `
            <small>Comète (club audiovisuel de Télécom Paris) - Secrétaire générale</small>
            Notre club audiovisuel, Comète, publie plus de 50 000 photos d'événements par an, sur un site ouvert à tous les étudiants. Retrouver celles où on apparaît peut vite devenir chronophage. J'ai donc prototypé une fonctionnalité pour que chacun puisse se retrouver dans les archives grâce à la reconnaissance faciale. L'outil fonctionnait, mais en me renseignant sur les enjeux liés aux données biométriques, j'ai décidé de ne pas le lancer. .
          `,
    'how.b2.title': "Des décisions réelles, en direct, en plusieurs langues",
    'how.b2.detail': `
            <small>Jeux Olympiques de Paris 2024</small>
            En tant qu'assistante du président du Comité Olympique Japonais pendant les Jeux de Paris 2024, je coordonnais la délégation japonaise avec les organisateurs locaux, au milieu de plannings mouvants et de priorités contradictoires. Tout se jouait en direct, dans 3 langues (JP/FR/EN). Au fond, la barrière de la langue n'a jamais été le plus dur : le vrai défi, c'était de trancher vite, sous le regard de tous.
          `,
    'how.b3.title': "Trouver le problème là où il se trouve vraiment",
    'how.b3.detail': `
            <small>EY - Conseil en stratégie et technologie</small>
            Pendant mon stage chez EY, j'ai mené 12 entretiens dans 4 pôles de l'entreprise sur la façon dont les équipes adoptent vraiment l'IA, que j'ai ensuite synthétisés en recommandations pour les managers. Le plus utile ne venait jamais du brief : il venait d'observer comment les gens travaillent réellement. Même réflexe sur mes propres projets : un doctorant en architecture m'a dit que concevoir à la manette était trop lent pour itérer, alors j'ai construit, avec deux amis, un outil VR piloté surtout par la voix.
          `,
    'how.b4.title': "Les contraintes comme le vrai travail, pas comme l'obstacle",
    'how.b4.detail': `
            <small>Bureau des Élèves de Télécom Paris</small>
            Avec mon équipe, nous étions responsables du budget et de la logistique d'un voyage de 20 000 € pour 90 personnes. Budget fixe, dates fixes, et plus d'envies que le budget ne pouvait en satisfaire : le vrai travail, c'était donc de décider ce qui comptait le plus et de couper le reste proprement. Les contraintes ne sont pas la partie pénible d'un projet ; ce sont souvent elles qui forcent la vraie décision.
          `,

    'portfolio.h2': "Portfolio",
    'portfolio.readMore': "le raisonnement ↓",
    'portfolio.lightboxClose': "Fermer l'image",
    'portfolio.expandVideo': "Agrandir la vidéo",
    'portfolio.showLess': "masquer le raisonnement ↑",
    'portfolio.labelProblem': "Le problème",
    'portfolio.labelTargetUser': "Utilisateur cible",
    'portfolio.labelCompetitors': "Alternatives existantes",
    'portfolio.labelInsight': "Le déclic",
    'portfolio.labelSolution': "Ma solution",
    'portfolio.labelFeedback': "Retours pour le moment",
    'portfolio.labelImpact': "Impact",

    'portfolio.p1.title': "Recette - Réseau social de retouche photo",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - Appli conçue solo, en beta fermée",
    'portfolio.p1.intro1': 'Je retouche des photos en amateur, et j\'ai un peu toujours le même problème : on peut admirer un rendu pendant des heures sans jamais réussir à le reproduire. Le « comment » reste enfermé dans l\'appli, ou dans la tête du créateur.',
    'portfolio.p1.intro2': 'J\'ai donc créé Recette, un réseau de retouche photo avec le pari central de traiter la retouche comme une <i>recette</i> copiable. On repère un rendu qu\'on aime dans le fil, et on le réapplique sur sa propre photo. Le but de l\'appli: réduire l\'écart entre « j\'aimerais que ma photo ressemble à ça » et y arriver pour de vrai.',
    'portfolio.p1.problem': "Un bon rendu photo s'admire facilement, mais se révèle généralement difficile à reproduire. La technique disparaît dès que la photo est publiée sur un réseau social.",
    'portfolio.p1.targetUser': "Les passionnés de retouche photo amateur, qui donnent de l'importance à la retouche. (Je garde moi-même souvent en capture d'écran les rendus que j'aime sur les réseaux sociaux, mais j'arrive rarement à les reproduire.)",
    'portfolio.p1.competitors': "VSCO et Lightroom permettent aux utilisateurs de sauvegarder et partager des <i>presets</i>, mais sous forme de fichiers isolés, déconnectés de la photo qui les a inspirés. Impossible de voir un rendu qu'on aime et d'obtenir sa recette exacte en un geste. ",
    'portfolio.p1.insight': "La plupart des applis photo partagent le résultat, l'image finie. Mais ce qui a réellement de la valeur dans le contexte de la retouche, c'est la transformation de l'image initiale pour obtenir le résultat. L'idée initiale que j'avais pour l'application penchait davantage vers une <i>marketplace</i> de préréglages, où on applique des rendus statiques, comme avec des pack de filtres. Mais un filtre statique ne s'adapte pas à toutes les photos.",
    'portfolio.p1.solution': "J'ai fait de la <i>recette</i> (= l'ensemble des réglages de retouche derrière une résultat final publié) l'objet central de l'appli. Le fil, le profil et l'éditeur devaient tous rendre les retouches remixables, et pas seulement afficher des images finies. Le système de calques verrouillés (inspiré de VSCO) était aussi une contrainte délibérée : j'ai choisi de ne pas laisser les utilisateurs déconstruire entièrement la retouche de quelqu'un d'autre jusqu'aux valeurs brutes, en sacrifiant la remixabilité maximale pour préserver l'attribution du créateur original. Et j'ai choisi de faire tourner les retouches sur l'appareil avec des shaders Skia plutôt qu'un rendu côté serveur plus simple, car une boucle sociale meurt dès qu'elle fait attendre l'utilisateur. Un compromis que j'ai fait : j'ai conçu une économie de gamification complète, avec des points pour publier, des points quand on est sauvegardé, une boutique pour les dépenser. Mais j'ai ensuite choisi de ne pas la déployer telle quelle. Mes premières modélisations montraient qu'elle créerait une dynamique de « les riches s'enrichissent » : les premiers utilisateurs à sauvegarder accumulent un avantage, et les nouveaux arrivants ne peuvent pas percer, l'inverse de ce qu'un fil de découverte devrait faire.",
    'portfolio.p1.feedback': "Toujours en bêta fermée, à petite échelle. La rétention est le chiffre que je surveille le plus, et j'essaie de voir comment la gamification peut l'augmenter. (N'hésitez pas à m'écrire si vous souhaitez également devenir bêta-testeur !)",
    'portfolio.p1.impact': "34 bêta-testeurs (début juillet), avec une rétention à J+7 d'environ 21%, une métrique que je cherche à optimiser à plus grand échelle :)",
    'portfolio.p1.videoCaption': "Parcours du fil d'actualité et remix d'une recette sur une nouvelle photo",

    'portfolio.p2.title': "Plateforme d'analyse de sentiment - Carte interactive",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - Projet de groupe, avec l'équipe de sciences sociales de l'école",
    'portfolio.p2.intro1': "L'équipe de sciences sociales de l'école est venue nous voir avec une question de recherche ouverte : comment un événement fait-il évoluer la réputation d'un lieu ? La réputation est déjà difficile à évaluer : on pourrait uniquement se baser sur les notes Google Reviews, mais celles-ci existent par milliers, et les utilisateurs ont chacun leur propre barême. Par exemple, \"Bien\" peut être équivalent à 3 étoiles comme 4, selon l'utilisateur.",
    'portfolio.p2.intro2': "Nous avons donc construit une carte interactive qui transforme les <i>commentaires</i> des avis publics en un signal quantitatif, lisible dans le temps et l'espace. Nous avons scrapé des avis Google, fait tourner une analyse de sentiment avec un modèle RoBERTa pour transformer le texte libre en valeurs exploitables, puis affiché le tout sur une carte Leaflet, pour qu'un événement et ses répercussions se lisent comme un motif dans le temps. Je me suis chargée de l'UI/UX.",
    'portfolio.p2.problem': "Un changement de réputation est réel mais difficile à étudier : il est éparpillé dans des milliers d'avis individuels, il évolue dans le temps, et rien de tout cela n'est visible en lisant les avis un par un.",
    'portfolio.p2.videoCaption': "Navigation dans l'interface.",
    'portfolio.p2.targetUser': "Les chercheurs de l'équipe de sciences sociales de l'école, qui avaient besoin de voir des motifs dans l'opinion publique au fil du temps.",
    'portfolio.p2.competitors': "Les tableaux de bord d'avis classiques (la note moyenne Google, les agrégateurs façon TripAdvisor...) n'affichent qu'un score statique, pas son évolution dans le temps ou l'espace. Une alternative manuelle aurait bien sûr été de lire les avis un par un et de noter leur sentiment à la main. Bien trop lent pour repérer un motif parmi des milliers d'avis.",
    'portfolio.p2.insight': "La première version affichait une heatmap continue. Cela supposait une interpolation à travers l'espace, alors que les données sous-jacentes sont en réalité des points d'avis discrets et inégalement répartis. Un pâté de maisons dense au centre-ville et un quartier résidentiel épars n'ont pas le même poids statistique. Dans cette première version, le dégradé encodait donc la quantité de données disponibles comme s'il s'agissait de « à quel point le sentiment est fort ici ». La solution a été de passer à des marqueurs individuels, dimensionnés et colorés pour que densité et intensité ne se mélangent plus en une seule couleur trompeuse.",
    'portfolio.p2.solution': "Nous avons scrapé des avis Google, fait tourner une analyse de sentiment RoBERTa sur le texte lui-même (pas seulement les notes en étoiles), et affiché le résultat sur une carte Leaflet avec un curseur d'année (pour que le changement dans le temps soit la première chose qu'on voit) et un curseur de période de moyennage. La décision la plus difficile a été de résister à l'envie de lisser les données, comme mentionné précédemment. Ce que nous avons choisi de ne pas construire : un support multi-villes ou une version publique. Ce projet était volontairement cadré sur une seule question de recherche pour un seul quartier, et le généraliser aurait signifié sacrifier la précision d'une année sur l'autre qui était tout l'intérêt du projet.",
    'portfolio.p2.mediaConceptCaption': "Concept original.",
    'portfolio.p2.mediaRealCaption': "Version finale.",

    'portfolio.p3.title': "Studio VR d'architecture piloté par la voix",
    'portfolio.p3.small': "Unity, Meta Quest, API Gemini - Projet de groupe",
    'portfolio.p3.intro1': "Tout est parti d'une conversation avec une doctorante en architecture, qui décrivait à quel point le prototypage 3D d'un bâtiment est une étape chronophage. Le plus difficile, c'est d'arriver à transformer rapidement les idées en une forme exploitable, visualisable.",
    'portfolio.p3.intro2': "Nous avons donc construit un studio en réalité virtuelle, où les architectes façonnent leurs prototypes dans l'espace, en utilisant majoritairement leur voix. L'utilisation des manettes Quest dans l'espace (pour de la modélisation 3D, par exemple) est souvent l'obstacle principal si l'utilisateur n'en a jamais utilisé. La voix contourne ce problème : on décrit ce qu'on veut oralement, et l'on obtient une première base de travail en quelques secondes. L'outil s'adapte ainsi à un large panel d'utilisateurs, expérimentés ou non. Sur ce projet, je me suis concentrée sur le design de l'interface et des interactions (UI/UX).",
    'portfolio.p3.problem': "Itérer sur un concept 3D de bâtiment est lent. Le principal frein est la friction pour transformer rapidement des idées en une forme 3D visualisable, en particulier pour des architectes peu habitués aux logiciels 3D et aux manettes de jeu/VR.",
    'portfolio.p3.media1Caption': "Phase de conception : Résumé par mots-clés généré par Gemini, pour montrer à l'utilisateur ce que le système a <i>compris</i> de ses descriptions.",
    'portfolio.p3.media2Caption': "Phase de génération : l'interface une fois que le système a généré les deux prototypes (à partir des descriptions orales envoyées à Gemini).",
    'portfolio.p3.targetUser': "Des professionnels techniques (architectes, étudiants en architecture travaillant sur des concepts de design) et des amateurs orientés design en général, pas nécessairement des personnes à l'aise avec des manettes de jeu ou les outils de CAO.",
    'portfolio.p3.competitors': "Les outils traditionnels (Rhino, SketchUp) sont précis mais ne permettent pas d'itérer rapidement sur des débuts de design, notamment car ils exigent de saisir des données assez précises (pour les dimensions, par exemple). La solution de contournement manuelle reste la maquette physique en mousse ou en carton. Les outils VR existants comme Gravity Sketch permettent de travailler en 3D dans l'espace, mais reposent toujours sur un usage avancé des manettes, ce qui réintroduit exactement l'obstacle qu'on cherchait à contourner pour des architectes <i>non-gamers</i>.",
    'portfolio.p3.insight': "La première version reposait encore sur des menus pour les actions courantes (choisir un type de mur, ajuster une dimension, changer un matériau), le schéma classique des applis VR. Ça allait à contre-courant du médium : les architectes essayaient de penser et d'itérer dans l'espace en temps réel, et chaque plongée dans un menu cassait ce flux. Nous avons réalisé que le coût d'interaction lui-même était le problème, pas quel élément de menu était mal étiqueté. La voix, passée par Gemini, a permis de décrire un changement en langage courant plutôt que de fouiller dans une hiérarchie.",
    'portfolio.p3.solution': "Nous avons construit un studio VR où l'utilisateur décrit ce qu'il veut, et l'API Gemini transforme ce langage naturel en actions 3D structurées, avec un résumé en mots-clés montré à l'utilisateur pour qu'il voie ce que le système a compris avant de valider. Cela impliquait de concevoir pour l'ambiguïté et l'intention plutôt que pour une saisie précise. L'essentiel du travail a consisté à rendre le système tolérant à la façon dont les gens formulent réellement les choses, ce qu'on n'a trouvé qu'en menant 7 itérations de design avec 9 utilisateurs. Ce que nous avons choisi de ne pas construire comptait tout autant : la collaboration multi-utilisateurs, et une voix vraiment libre - nous avons fait passer la parole par Gemini, mais en cadrant quand même l'espace des intentions plutôt que d'accepter des commandes arbitraires, échangeant l'étendue des commandes contre la fiabilité de celles qui comptaient vraiment.",
    'portfolio.p3.feedback': "Le retour le plus clair était comportemental : voir quelqu'un buter sur une commande qu'on pensait évidente était plus utile que tout ce qu'il aurait pu dire après coup. La commande « évidente » l'était rarement dès le premier essai.",

    'portfolio.p4.title': "Traitement d'images et mécatronique pour la cécité",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - Top 3% au TIPE (échelle nationale), noté 20/20",
    'portfolio.p4.intro1': 'En 2024, le TIPE avait pour thème le sport. Je me suis intéressée à la question suivante : qui ne peut pas profiter d\'un match aujourd\'hui ? Les spectateurs malvoyants entendent l\'ambiance du stade, mais perdent le fil de là où se trouve vraiment le ballon.',
    'portfolio.p4.intro2': "J'ai donc construit un système de suivi qui repère le ballon dans un flux d'images et transmet sa position par le toucher plutôt que par la vue : reconnaissance du ballon par IA et détection du terrain, traduites en quelque chose qui se ressent au lieu de se voir.",
    'portfolio.p4.problem': "Les spectateurs malvoyants profitent du son et de l'ambiance du stade, mais perdent la seule information qui explique vraiment le jeu, qu'est la localisation du ballon à l'instant présent.",
    'portfolio.p4.mediaCoverCaption': "L'idée principale du projet",
    'portfolio.p4.mediaAlgorithmCaption': "Algorithme complet",
    'portfolio.p4.mediaHardwareCaption': "La partie sensorielle pour l'utilisateur (12 cm), pilotée par une carte Arduino.",
    'portfolio.p4.mediaDetectionCaption': "Détection du ballon.",
    'portfolio.p4.mediaPositionsCaption': "Erreur de localisation selon les positions de caméra testées (azimut/élévation) - erreur minimale de 0,035 m.",
    'portfolio.p4.targetUser': "Les spectateurs aveugles et malvoyants assistant à un match en direct, qui ont besoin d'une information de position assez rapide pour suivre une action pendant qu'elle se déroule.",
    'portfolio.p4.competitors': "La plupart des matchs importants sont commentés en direct, mais cela ne permet pas le suivi continu de la position de la balle. La solution de contournement manuelle la plus courante aujourd'hui est un accompagnant voyant assis à côté du spectateur, qui commente discrètement la position du ballon en temps réel.",
    'portfolio.p4.insight': "Ma première version utilisait un modèle de détection fonctionnant à plus haute résolution, en privilégiant la précision et en traitant la latence comme secondaire. Mais en pratique, un délai de deux secondes suffit à rendre le système trompeur, puisque l'utilisateur ressentirait une action déjà passée. C'est pourquoi j'ai décider de priviligier la fréquence d'images et la latence, ce qui m'a orientée vers un modèle YOLOv9 avec une image en entrée de plus basse résolution.",
    'portfolio.p4.solution': "J'ai fait de la latence la contrainte principale, en acceptant en échange une marge d'erreur tolérable : 180 ms d'inférence et environ 6 mètres d'erreur de localisation. Cette erreur de +/-6 m est assez précise pour transmettre « le ballon est sur l'aile gauche, près de la surface » (le système physique étant plutôt petit). J'ai également testé 60 emplacements de caméra pour trouver le vrai équilibre couverture/précision, plutôt que de deviner un angle « évidemment bon ». Ce que je n'ai pas construit : un système de suivi de tous les joueurs. Cela aurait ajouté de la latence et de la complexité pour une information qu'un spectateur aveugle perçoit déjà en partie grâce au bruit de la foule et au commentaire.",
    'portfolio.p4.impact': "Projet classé dans le top 3% national au TIPE, noté 20/20. Penser à tous les profils qui existent autour du sport m'a menée à ce projet etreste ma manière préférée de choisir mes problèmes !",

    'cv.h2': "CV",
    'cv.intro': "Tout ce qui précède, condensé en une seule page.",
    'cv.download': "Mon cv ↓",
    'cv.arrowText': "N'hésitez pas à me contacter !",

    'creative.h2': "Autres projets créatifs",
    'creative.intro': "En dehors du côté pro, j'adore tout ce qui laisse parler ma créativité ! Voici quelques projets personnels. (Cliquez pour les voir en plein écran!)",
    'creative.thingsIMake': "Du graphisme",
    'creative.thingsIShoot': "De l'image",
    'creative.thingsIDo': "Et d'autres choses...",
    'creative.thingsIDoText': "Après avoir fait de la danse classique pendant 12 ans, je me suis récemment mise au patinage artistique. J'adore aussi la musique (que ce soit jouer du piano, ou écouter RAYE et a6el), et faire de jolis gâteaux :) ",

    'creative.viewOnCanva': "Voir sur Canva ↗",
    'creative.viewOnInstagram': "Voir sur Instagram ↗",
    'creative.viewOnDrive': "Voir sur Drive ↗",

    'creative.alpha.title': "Plaquette Alpha",
    'creative.alpha.desc': "J'ai conçu environ un tiers du magazine présentant le campus et la vie étudiante de l'école, destiné aux candidats de classes préparatoires, tiré à environ 3 000 exemplaires.",
    'creative.guide.title': "Guide de Barcelone",
    'creative.guide.desc': "Dans le cadre de mon rôle au Bureau des Élèves, j'ai aidé à organiser un voyage à Barcelone pour 90 étudiants, et conçu ce livret pour guider tout le monde dans les meilleures conditions.",
    'creative.poster.title': "Affiches d'événements",
    'creative.poster.desc': "Etant membre de trois associations à Télécom Paris, j'ai conçu diverses affiches pour promouvoir des événements.",
    'creative.website.title': "Ce site",
    'creative.website.desc': "Design du poussin, icônes personnalisées, modélisation 3D et animation, pour donner vie à ce portfolio !",

    'creative.barcelonaRecap.title': "Récap du voyage à Barcelone",
    'creative.barcelonaRecap.desc': "Ma vidéo récap de notre voyage à Barcelone organisé par le Bureau des Élèves.",
    'creative.aix.title': "Été dans le Sud",
    'creative.aix.desc': "Un bref carnet de voyage dans le Sud, entre amis. Images tournées avec un ami.",
    'creative.flash.title': "Photographie au flash",
    'creative.flash.desc': "Série d'inspiration Y2K tournée et éditée avec des amis, dans des espaces publics autour du plateau de Saclay.",
    'creative.wei.title': "Weekend d'intégration des 1A à Télécom Paris",
    'creative.wei.desc': "Images tournées par mon club audiovisuel, que j'ai ensuite montées.",
    'creative.film.title': "Argentique",
    'creative.film.desc': "Quelques photos prises lors de voyages en France et en Europe avec mon appareil argentique, retouchées sur Lightroom.",
    'creative.ski.title': "Récap du Week-End Ski",
    'creative.ski.desc': "Un projet solo réalisé pour le Bureau des Élèves, tourné et monté de A à Z.",

    'footer.text': "Portfolio fait avec amour, three.js et un poussin très dévoué. Merci de m'avoir lue ! ",

    nextSectionTitles: ['A propos', 'Parcours', 'Ma façon de travailler', 'Portfolio', 'CV', 'Autres projets créatifs', null, null],
  },
  ja: {
    'social.nav': "ソーシャルリンク",
    'social.email': "メールを送る",
    'nav.pageNav': "ページナビゲーション",
    'nav.home': "ホームに戻る",
    'nav.chooseLanguage': "言語を選択",
    'nav.about': "自己紹介",
    'nav.howIWork': "働き方",
    'nav.portfolio': "ポートフォリオ",
    'nav.cv': "履歴書",
    'nav.creative': "その他の作品",
    'nav.nextSection': "次のセクションへスクロール",

    'hero.hello': "文化 · 工学 · デザイン",
    'hero.h1': "はじめまして、リリアです。",
    'hero.scrollHint': "もっと詳しく↓",

    'about.h2': "はじめまして。",
    'about.intro': "フランス語と日本語に囲まれて育ち、ドイツ語と英語も学んできたことから、日常的に四つの言語を使い分けるようになりました。そこで自然と身についたのは「同じものでも、どこから見るかで全く違うものになる」という感覚です。そこから興味を持つようになったのは、言語の翻訳ではなく、領域をまたぐ翻訳でした。デザイナーが捉えているもの、エンジニアが実現できること、ロードマップが求めていること——それぞれ違う言葉で語られるものを、チーム全員が迷わず動けるひとつのプロダクト判断に落とし込む。私が一番力を発揮できるのは、まさにその接点だと感じています。",
    'about.status': '現在はArianeGroupでソフトウェアエンジニアリングのインターンをしていますが、<strong>2027年春または夏開始のプロダクトマネージャーインターンシップ</strong>を探しています。',

    'timeline.h2': "経歴",
    'timeline.academics': "学歴",
    'timeline.professional': "職歴",
    'timeline.msc': "工学修士課程 (MEng)、<a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a>(<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>)。<br><small>フランスを代表する工学系グランゼコールの一つ(選抜制の入学試験を経て入学)。2026年7月にBachelorを獲得。</small><br><br>専攻:データサイエンス&AI + 3Dグラフィックス&インタラクション(HCI)",
    'timeline.arianegroup.company': "<a href=\"https://www.ariane.group/en/\" target=\"_blank\" rel=\"noopener\">ArianeGroup</a>",
    'timeline.arianegroup.role': "ソフトウェアエンジニアリングインターン",
    'timeline.dataannotation.company': "<a href=\"https://www.dataannotation.tech\" target=\"_blank\" rel=\"noopener\">DataAnnotation</a>",
    'timeline.dataannotation.role': "AI評価(パートタイム)",
    'timeline.ey.company': "<a href=\"https://www.ey.com/ja_jp\" target=\"_blank\" rel=\"noopener\">EY</a>",
    'timeline.ey.role': "戦略・ITコンサルティングインターン",
    'timeline.joc.company': "<a href=\"https://www.joc.or.jp\" target=\"_blank\" rel=\"noopener\">日本オリンピック委員会</a>",
    'timeline.joc.role': "会長アシスタント",

'how.h2': "働き方",
    'how.b1.title': "リリースするか、しないか",
    'how.b1.detail': `
            <small>Comète(Télécom Parisの映像制作クラブ)- 事務局長</small>
            Télécom Parisの映像制作クラブComèteは、全学生がアクセスできるサイトに、年間5万枚を超える写真を掲載しています。そのため、自分が写っている一枚を探し出すのは意外と大変です。そこで顔認識を使い、誰もがアーカイブの中から自分自身を見つけられる機能をプロトタイプしました。技術的には問題なく動いたのですが、生体データにまつわる課題を調べていくうちに、リリースしないという判断に至りました。これまでで一番難しかったプロダクトの決断は、何かを作ることではなく、あえて世に出さないと決めることでした。
          `,
    'how.b2.title': "複数の言語での、リアルタイムな決断",
    'how.b2.detail': `
            <small>パリ2024オリンピック</small>
            パリ2024オリンピック期間中、日本オリンピック委員会会長付アシスタントとして、刻々と変わるスケジュールや利害の対立が入り混じるなか、日本代表団と現地関係者との調整を担いました。すべてがその場での即断を求められ、しかも日本語・フランス語・英語が飛び交う環境です。振り返ってみると、一番の難しさは言語の壁ではありませんでした。本当に大変だったのは、多くの人が見ている中で、素早く判断を下し続けることだったのです。
          `,
    'how.b3.title': "問題が本当にある場所を見つける",
    'how.b3.detail': `
            <small>EY - 戦略・テクノロジーコンサルティング</small>
            EYでのインターン中、チームが実際にどうAIを使っているのかを知るため、社内4部門で12件のインタビューを行い、経営層向けの提言にまとめました。本当に役立つ情報は、ブリーフィングからではなく、人々が働く様子を実際に観察することから得られました。この感覚は、自分自身のプロジェクトにも通じています。建築を学ぶ博士課程の学生から「コントローラーでの設計は試行錯誤するには遅すぎる」と聞き、友人2人とともに、主に音声で操作するVRツールを開発しました。推測に頼るのではなく、現場の人と実際に話すことがどれほど大切か、そこから学びました。
          `,
    'how.b4.title': "制約は仕事の障害ではなく、仕事そのもの",
    'how.b4.detail': `
            <small>Télécom Paris学生委員会</small>
            チームで、90人・予算2万ユーロの旅行について、予算組みと手配を担当しました。予算も日程も動かせないなか、やりたいことは膨らむ一方。だからこそ、何を最優先にするかを見極めることが本当の仕事でした。制約はプロジェクトの厄介な部分ではありません。むしろ、本当の意味での決断を迫ってくれるものなのです。
          `,
        
    'portfolio.h2': "ポートフォリオ",
    'portfolio.readMore': "思考 ↓",
    'portfolio.lightboxClose': "閉じる",
    'portfolio.expandVideo': "拡大",
    'portfolio.showLess': "思考の過程を閉じる ↑",
    'portfolio.labelProblem': "課題",
    'portfolio.labelTargetUser': "対象ユーザー",
    'portfolio.labelCompetitors': "既存の代替手段",
    'portfolio.labelInsight': "きっかけ",
    'portfolio.labelSolution': "解決策",
    'portfolio.labelFeedback': "現在までの反応",
    'portfolio.labelImpact': "成果",

    'portfolio.p1.title': "Recette - ソーシャル写真編集アプリ",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - 個人開発、クローズドベータ中",
    'portfolio.p1.intro1': "趣味で写真編集をしていると、いつも同じ問題。どれだけある仕上がりを眺めても、同じようには再現できない。「どうやったのか」が、アプリの中か作った本人の頭の中に閉じたままだからだ。",
    'portfolio.p1.intro2': "それがRecetteを作ったきっかけです。写真編集のソーシャルアプリで、発想はシンプル。編集をコピーできる「レシピ」として扱うこと。フィードで気に入った仕上がりを見つけたら、自分の写真にそのまま当てられます。「こんな風にしたい」という気持ちを実現できるプロダクトです。",
    'portfolio.p1.problem': "良い写真の仕上がりは、見て憧れるのは簡単でも、再現するのは難しい。その編集のノウハウは、写真がSNSに投稿された瞬間に消えてしまいます。",
    'portfolio.p1.targetUser': "編集そのものを楽しむ、写真好きな人たち。SNSで気に入った仕上がりをスクショしては、自力で真似しようとして挫折してしまうような方。",
    'portfolio.p1.competitors': "VSCOやLightroomでもプリセットの保存・共有はできますが、あくまで単体のファイルで、元の写真とは切り離されています。気に入った仕上がりを見て、そのレシピをワンタップで手に入れるということはできません。現実の回避策は、スクショを撮るか、コメント欄でプリセットを聞くかです。",
    'portfolio.p1.insight': "多くの写真編集アプリが共有するのは「結果」、つまり完成した画像です。でも本当に価値があって人に渡せるのは、結果そのものではなく「変換のプロセス」のほうです。最初に思いついたのは、静的なルックを当てるプリセットのマーケットプレイスで、フィルターパックとほぼ同じ発想でした。でも初期のスケッチの段階で限界が見えました。フィルターは固定で、実際の写真に適応しないからです。本当の課題の輪郭が見えたのは、ある場面を想像したときです。誰かが「その仕上がり、どうやったの？」と聞いて、正直に答えようとすると、手作業では誰にも再現できないような設定の羅列になってしまう。憧れる気持ちと、実際にそれを再現できることの間にあるこのギャップこそが、プロダクトの核でした。",
    'portfolio.p1.solution': "<i>レシピ</i>をアプリの中心オブジェクトに据えました。フィード、プロフィール、エディターのすべてが、完成した画像を見せるだけでなく、編集内容を読み取ってリミックスできる設計である必要がありました。VSCOのロックレイヤー方式を参考にしたのも意図的な制約です。他人の編集を生の数値まで完全に分解できないようにし、リミックスの自由度よりも、元のクリエイターへの帰属を優先しました。また、よりシンプルなサーバーサイドレンダリングではなく、Skiaシェーダーによる端末上での処理を選んでいます。ソーシャルのループは、ユーザーを待たせた瞬間に壊れるからです。もうひとつのトレードオフとして、投稿やセーブに対するポイント付与とストアを含む完全なゲーミフィケーション経済を設計しましたが、そのままではリリースしませんでした。初期のモデリングで、「持てる者がさらに持つ」構造になると分かったからです。早期ユーザーほど有利になり、新規ユーザーが入り込めなくなる。それは発見のためのフィードが目指すべきこととは正反対でした。",
    'portfolio.p1.feedback': "まだクローズドベータの段階なので、今いちばん確かな手がかりは大規模な調査ではなく実際の利用データです。もっとも注視しているのは継続率で、それを改善するために今まさに実験しているのがゲーミフィケーションです。もし読んでいてベータテスターに興味があれば、ぜひご連絡ください！",
    'portfolio.p1.impact': "ベータユーザー34人 (7月上旬時点)、初週継続率は約21%。ここを伸ばすのが当面の目標です。",
    'portfolio.p1.videoCaption': "フィードで好みのルックを見つけ、新しい写真にレシピをリミックスする様子",

    'portfolio.p2.title': "レビュー感情分析プラットフォーム - インタラクティブマップ",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - グループプロジェクト、学校の社会科学チームとの共同研究",
    'portfolio.p2.intro1': "学校の社会科学チームから、ある出来事が場所の評判を時間とともにどう変えるのか、というオープンな研究課題を持ちかけられました。扱いづらいテーマです。評判は輪郭が曖昧で、何千件もの口コミに散らばり、しかも常に動いている。彼らに必要だったのは、評判を言葉で説明することではなく、目に見える形にすることでした。",
    'portfolio.p2.intro2': "そこで、ばらばらに存在する公開口コミを、読み取れるシグナルに変えるインタラクティブマップを構築しました。Googleレビューをスクレイピングし、RoBERTaで感情分析にかけてフリーテキストを扱いやすいシグナルに変換。それをLeafletの地図上に重ね、ある出来事とその余波が時間の経過とともにパターンとして浮かび上がるようにしました。私はUI/UXを担当しました。",
    'portfolio.p2.problem': "評判の変化は確かに起きていますが、研究するのは容易ではありません。何千もの個別の意見に散らばり、時間とともに移り変わり、レビューを一件ずつ読むだけではどれも見えてこないからです。",
    'portfolio.p2.videoCaption': "キャプションを追加",
    'portfolio.p2.targetUser': "学校の社会科学チームの研究者たち。世論の時系列パターンを把握する必要がありました。",
    'portfolio.p2.competitors': "既存のレビューダッシュボード (Google自体の平均評価やTripAdvisorのような集計サービス)は静的なスコアを出すだけで、時間的・地域的な変化は見えません。手作業の代替策としては、レビューを一件ずつ読んで感情を手動で集計する方法もあります。正確ではありますが、何千件ものレビューからパターンを見つけるには遅すぎます。",
    'portfolio.p2.insight': "最初のバージョンは連続ヒートマップで表示していて、見た目にはそれらしく見えましたが、実は嘘をついていました。ヒートサーフェスは地理空間上の補間を前提としますが、実際のデータは離散的で、サンプル密度も場所ごとに偏ったレビュー群です。中心部の密集したブロックとまばらな住宅地では、統計的な重みがまったく違います。結果として最初のバージョンでは、データの「量」が感情の「強さ」であるかのように表示されていました。解決策は個別マーカーへの切り替えです。密度と強度がひとつの色に混ざらないよう、それぞれをサイズと色で分けて表現しました。",
    'portfolio.p2.solution': "Googleレビューをスクレイピングし、星評価だけでなくテキスト本文にRoBERTaで感情分析をかけ、その結果を年スライダー (時間変化がまず目に入るように)と平均期間スライダー付きのLeafletマップ上に表示しました。設計上より難しかったのは、前述の通り、データを滑らかに見せたい誘惑に抗うことでした。あえて作らなかったもの：複数都市への対応と一般公開版です。このプロジェクトはひとつの地区、ひとつの研究課題に意図的に絞っており、汎用化すればこのプロジェクトの核だった年単位の精度が犠牲になるはずでした。",
    'portfolio.p2.mediaConceptCaption': "キャプションを追加",
    'portfolio.p2.mediaRealCaption': "キャプションを追加",

    'portfolio.p3.title': "音声操作型VR建築スタジオ",
    'portfolio.p3.small': "Unity, Meta Quest, Gemini API - グループプロジェクト",
    'portfolio.p3.intro1': "きっかけは、建築を学ぶ博士課程の学生との会話でした。3Dの建物デザインをプロトタイピングして試行錯誤する作業がいかに遅いか、という話です。ボトルネックはアイデアそのものではなく、それを素早く形にするまでの摩擦でした。",
    'portfolio.p3.intro2': "そこで、建築家が空間の中で直接プロトタイプを形づくれるVRスタジオを作りました。核となる判断は、コントローラーを音声に置き換えたことです。ゲームをしない人にQuestのコントローラーを2本渡して、スムーズな3D操作を期待するのは、それだけでハードルが高すぎます。操作方法そのものが壁になる。音声ならそれを回避できます。欲しいものを言葉で伝えれば、インターフェースはほとんど意識の外に退きます。こうしてツールは、ユーザーにゲーマーであることを求めるのではなく、実際の使い手に合わせる形になりました。私はインタラクションデザインを担当しました。",
    'portfolio.p3.problem': "3Dの建物コンセプトを試行錯誤するのには時間がかかります。主なボトルネックは、アイデアを素早く目に見える3Dの形にするまでの摩擦です。特に3Dソフトやゲーム・VRの操作に慣れていない建築家にとっては、なおさらです。",
    'portfolio.p3.media1Caption': "設計フェーズ：Geminiが生成したキーワード要約を加え、ユーザーの発話をシステムがどう<i>解釈した</i>のかを示せるようにしました。",
    'portfolio.p3.media2Caption': "生成フェーズ：ユーザーの発話をGeminiに渡し、システムが2つのプロトタイプ案を生成した後のUIです。",
    'portfolio.p3.targetUser': "技術系の専門家 (建築家や、初期段階のコンセプトに取り組む建築学生)と、デザイン志向のアマチュア。ゲーム機や3D操作に慣れている人だけを想定したものではありません。",
    'portfolio.p3.competitors': "RhinoやSketchUpのような従来型ツールは精度は高い反面、かなり正確なデータ入力を要求するため、初期コンセプトを素早く試行錯誤するには向いていません。手作業の代替策は、今も発泡スチロールや厚紙によるマスモデルです。Gravity Sketchのような既存のVRデザインツールは、空間内での3D作業という点は解決していますが、依然ハンドコントローラーに頼っており、ゲーマーでない建築家にとっては取り除きたかった壁をそのまま持ち込んでしまいます。",
    'portfolio.p3.insight': "最初のバージョンでは、壁の種類の選択、寸法の調整、素材の変更といった操作を、典型的なVRアプリのパターンに倣ってメニューで処理していました。しかしこれはVRという媒体と根本的に相性が悪かった。建築家たちは空間の中でリアルタイムに考え、試行錯誤したいのに、メニューに潜るたびにその流れが断ち切られてしまうからです。気づいたのは、問題は「どのメニュー項目が分かりにくいか」ではなく、「操作にかかるコスト」そのものにあるということでした。Geminiを介した音声操作により、階層を辿る代わりに、変更したい内容を自然な言葉で伝えられるようになりました。",
    'portfolio.p3.solution': "ユーザーが欲しいものを言葉で説明すると、Gemini APIがその自然言語を構造化された3Dアクションに変換するVRスタジオを構築しました。システムが何を理解したかをユーザーが確認してから確定できるよう、キーワード要約も画面に表示しています。つまり、正確な入力ではなく曖昧さと意図に寄り添う設計です。実際の作業の多くは、人が実際に使う言い回しに対してシステムを柔軟にすることに費やされ、それは9人のユーザーと7回のイテレーションを重ねて初めて見えてくるものでした。あえて作らなかったものも同じくらい重要です。複数人での共同作業と、完全に自由な音声入力。発話はGeminiを通して処理しましたが、意図の範囲はある程度限定し、あらゆるコマンドを受け付ける設計にはしませんでした。対応範囲の広さよりも、本当に重要なコマンドの信頼性を優先したということです。",
    'portfolio.p3.feedback': "いちばん多くを学べたのは、行動の観察からでした。当たり前だと思っていたコマンドで誰かがつまずく瞬間を見ることは、後から聞くどんなフィードバックよりも役に立ちました。「当たり前」のコマンドが最初から本当に当たり前だったことは、ほとんどありませんでした。",

    'portfolio.p4.title': "視覚障がい者のための画像処理とメカトロニクス",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - TIPE全国上位3%、20/20評価",
    'portfolio.p4.intro1': "2024年のTIPE (フランスの理工系グランゼコール入試における研究課題)のテーマはスポーツでした。周りの学生の多くがパフォーマンス分析に向かう中、私が立てたのは別の問いです。いま試合を楽しめずにいるのは誰だろう？視覚に障がいのある観客は、スタジアムの熱気を耳で感じることはできても、ボールが実際にどこにあるかは追えません。",
    'portfolio.p4.intro2': "そこで、ボールの位置を視覚ではなく触覚で伝えるトラッキングシステムを構築しました。AIによるボール認識とフィールド検出を組み合わせ、「見る」情報を「触れる」情報に変換しています。",
    'portfolio.p4.problem': "視覚障がいのある観客はスタジアムの音や熱気を感じることはできますが、試合を本当に追うために必要なたったひとつの情報——「今、ボールがどこにあるか」——が分かりません。",
    'portfolio.p4.mediaCoverCaption': "プロジェクトの中心となるアイデア",
    'portfolio.p4.mediaAlgorithmCaption': "アルゴリズムの全体像",
    'portfolio.p4.mediaHardwareCaption': "実際のハードウェア。ユーザーに触れる感覚部分はわずか12cmです。",
    'portfolio.p4.mediaDetectionCaption': "ボール検出。",
    'portfolio.p4.mediaPositionsCaption': "検証した方位角・仰角ごとのカメラ配置における位置誤差。最小誤差は0.035m。",
    'portfolio.p4.targetUser': "試合を生で観戦する視覚障がいのある観客。プレーが起きているその瞬間に追えるだけの速さで、位置情報が届く必要があります。",
    'portfolio.p4.competitors': "音声解説はほとんどのスタジアムにすでにありますが、あれは人間が言葉で語る解説であり、連続的な位置データではありません。本質的に遅れがあり、ピッチ上のどこにボールがあるかを秒単位で正確に伝えることもできません。現状よくある回避策は、隣に座った目の見える付き添いが、その場でボールの位置を小声で伝え続けることです。",
    'portfolio.p4.insight': "最初のバージョンでは、より重く高解像度な検出モデルを使い、精度を優先して遅延は後回しにしていました。実際のエッジ/Arduinoパイプラインで動かした途端、破綻しました。2秒の遅れがあれば、もう終わったプレーを触覚で感じることになる——システム全体がミスリードになるには十分です。気づいたのは、精度は意味のあるタイミングで届いて初めて価値を持つということでした。だからこそ高い精度をフレームレートと低遅延のために手放し、低解像度入力のYOLOv9モデルに切り替えました。",
    'portfolio.p4.solution': "遅延を最優先の制約とし、その代わりに許容できる誤差を受け入れました。推論時間180ミリ秒、位置精度は約6メートルです。それを12cmの感覚ボード上で、指に感じられる触覚バンドに変換しています。この±6メートルの誤差は、物理デバイス自体が小さいこともあり、「ボールは左サイド、ペナルティエリア付近」と伝えるには十分です。ハードウェアについても同じ考え方です。「良さそうな角度」を感覚で決めるのではなく、実際のカバー範囲と精度の最適なバランスを見つけるために60通りのカメラ配置を検証しました。あえて作らなかったもの：全選手のトラッキングです。それを入れれば、視覚障がいのある観客が歓声や解説からすでにある程度得ている情報のために、遅延と複雑さを増やすことになっていたはずです。",
    'portfolio.p4.impact': "フランスの理工系学生向け研究コンテストTIPEで全国上位3%に入り、20/20の評価を受けました。スポーツを取り巻くさまざまな立場の人たち——選手、観客、スタッフ——を想像したことが、このプロジェクトの出発点でした。「取り残されているのは誰か」から始めること。それが今も変わらない、私の課題の選び方です。",
    'cv.h2': "履歴書",
    'cv.intro': "これまでの内容を1ページに凝縮しました。",
    'cv.download': "履歴書 ↓",
    'cv.arrowText': "お気軽にご連絡ください!",

    'creative.h2': "その他の作品",
    'creative.intro': "仕事以外でも、何かを創作すること全般が大好きです!個人的なプロジェクトをいくつか紹介します:) クリックすると全画面で見られます。",
    'creative.thingsIMake': "つくるもの",
    'creative.thingsIShoot': "撮るもの",
    'creative.thingsIDo': "その他",
    'creative.thingsIDoText': "12年間クラシックバレエを習っていましたが、最近はフィギュアスケートを始めました。音楽も大好きで、ピアノを弾いたり、RAYEやa6elを聴いたりしています。かわいいケーキを焼くのも好きです :) ",

    'creative.viewOnCanva': "Canvaで見る ↗",
    'creative.viewOnInstagram': "Instagramで見る ↗",
    'creative.viewOnDrive': "Driveで見る ↗",

    'creative.alpha.title': "Plaquette Alpha",
    'creative.alpha.desc': "学校のキャンパスと学生生活を紹介する冊子の、約3分の1をデザインしました。グランゼコール受験準備クラスの志望者向けで、約3,000部印刷されました。",
    'creative.guide.title': "バルセロナ旅行ガイド",
    'creative.guide.desc': "学生委員会での役割の一環として、90人の学生とのバルセロナ旅行の企画を手伝い、全員を案内するためのこの冊子をデザインしました。",
    'creative.poster.title': "イベントポスター",
    'creative.poster.desc': "Télécom Parisの3つの団体に所属していた際、イベント告知用のさまざまなポスターをデザインしました。",
    'creative.website.title': "このサイト",
    'creative.website.desc': "ひよこのキャラクターデザイン、オリジナルアイコン、3Dモデリング、アニメーションを手がけ、このポートフォリオに命を吹き込みました!",

    'creative.barcelonaRecap.title': "バルセロナ旅行の記録",
    'creative.barcelonaRecap.desc': "学生委員会主催のバルセロナ旅行をまとめたダイジェスト動画です。",
    'creative.aix.title': "南フランスの夏",
    'creative.aix.desc': "友人たちと過ごした南フランスでの、ちょっとした旅の記録です。撮影も友人と一緒に。",
    'creative.flash.title': "フラッシュフォトグラフィー",
    'creative.flash.desc': "Y2Kなシリーズ。友人たちとサクレー高原周辺で撮影・編集しました。",
    'creative.wei.title': "Télécom Paris新入生歓迎ウィークエンド",
    'creative.wei.desc': "所属する映像制作クラブが撮影した映像を、私が編集しました。",
    'creative.film.title': "フィルム写真",
    'creative.film.desc': "フランスとヨーロッパ各地を旅した際にフィルムカメラで撮影した写真です。Lightroomで編集しました。",
    'creative.ski.title': "スキー旅行の記録",
    'creative.ski.desc': "学生委員会向けに制作したソロプロジェクトで、撮影から編集まですべて一人で手がけました。",

    'footer.text': "愛を込めて作ったウェブサイトです。読んでくれてありがとう!",

    nextSectionTitles: ['自己紹介', '経歴', '働き方', 'ポートフォリオ', '履歴書', 'その他の作品', null, null],
  },
  de: {
    'social.nav': "Soziale Links",
    'social.email': "E-Mail schreiben",
    'nav.pageNav': "Seitennavigation",
    'nav.home': "zurück zur Startseite",
    'nav.chooseLanguage': "Sprache wählen",
    'nav.about': "Über mich",
    'nav.howIWork': "Meine Arbeitsweise",
    'nav.portfolio': "Portfolio",
    'nav.cv': "Lebenslauf",
    'nav.creative': "Weitere Projekte",
    'nav.nextSection': "zum nächsten Abschnitt scrollen",

    'hero.hello': "Kulturen · Technik · Design",
    'hero.h1': "Hallo, ich bin Lylia!",
    'hero.scrollHint': "um mehr über mich zu erfahren ↓",

    'about.h2': "Schön, dich kennenzulernen!",
    'about.intro': "Aufgewachsen zwischen Französisch und Japanisch, mit Deutsch und Englisch dazu – vier Sprachen, aber vor allem vier verschiedene Arten, dasselbe Problem zu denken. Dieser ständige Wechsel zwischen Denkrahmen hat mir den Geschmack für Übersetzung im weiteren Sinne gegeben: nicht zwischen Wörtern, sondern zwischen Disziplinen. Ingenieurwesen, Design, Strategie – was mich begeistert, ist die Verbindung zwischen den dreien: sehen, was ein Designer sieht, verstehen, was ein Ingenieur bauen kann, und wissen, was eine Roadmap verlangt, um daraus eine gemeinsame Entscheidung zu formen, auf der ein ganzes Team aufbauen kann. Genau da will ich sein!",
    'about.status': 'Jetzt Praktikantin (Softwareentwicklung) bei ArianeGroup in Frankreich. Ich suche ein <strong>Product Management Praktikum, das zwischen März und Juni 2027 beginnt.</strong>',

    'timeline.h2': "Werdegang",
    'timeline.academics': "Ausbildung",
    'timeline.professional': "Berufserfahrung",
    'timeline.msc': "Masterstudium Ingenieurwissenschaften, <a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a> (<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>).<br><small>Eine der renommiertesten französischen Ingenieurhochschulen (Grande École, Zulassung über ein selektives Auswahlverfahren).</small><br><br>Schwerpunkte: Data Science &amp; KI + 3D-Grafik &amp; Interaktion (HCI)",
    'timeline.arianegroup.company': "<a href=\"https://www.ariane.group/de/\" target=\"_blank\" rel=\"noopener\">ArianeGroup</a>",
    'timeline.arianegroup.role': "Praktikantin Softwareentwicklung",
    'timeline.dataannotation.company': "<a href=\"https://www.dataannotation.tech\" target=\"_blank\" rel=\"noopener\">DataAnnotation</a>",
    'timeline.dataannotation.role': "KI-Bewerterin (Teilzeit)",
    'timeline.ey.company': "<a href=\"https://www.ey.com/de_de\" target=\"_blank\" rel=\"noopener\">EY</a>",
    'timeline.ey.role': "Praktikantin Strategie- &amp; Technologieberatung",
    'timeline.joc.company': "<a href=\"https://www.joc.or.jp/english/\" target=\"_blank\" rel=\"noopener\">Japanisches Olympisches Komitee</a>",
    'timeline.joc.role': "Assistentin des Präsidenten",

    'how.h2': "Meine Arbeitsweise",
    'how.b1.title': "Launchen oder nicht launchen",
    'how.b1.detail': `
            <small>Comète (Audiovisueller Studierendenclub der Télécom Paris) - Generalsekretärin</small>
            Unser Audiovisual-Club Comète veröffentlicht jährlich über 50.000 Eventfotos auf einer offenen Website. Sich selbst darin wiederzufinden ist mühsam. Also habe ich eine Gesichtserkennungs-Funktion prototypisiert, mit der man sich in den Archiven wiederfindet. Das Tool funktionierte- aber nachdem ich mich mit den Fragen rund um biometrische Daten auseinandergesetzt hatte, habe ich mich entschieden, es nicht zu veröffentlichen. Die schwierigste Produktentscheidung, die ich bisher getroffen habe, war nicht etwas, das ich gebaut habe; sondern etwas, das ich bewusst zurückgehalten habe.
          `,
    'how.b2.title': "Echte Entscheidungen, live, über mehrere Sprachen hinweg",
    'how.b2.detail': `
            <small>Olympische Spiele Paris 2024</small>
            Als Assistentin des Präsidenten des Japanischen Olympischen Komitees während der Spiele in Paris 2024 habe ich die japanische Delegation mit den lokalen Organisatoren koordiniert - bei ständig wechselnden Zeitplänen und widersprüchlichen Interessen. Alles musste live entschieden werden, in 3 Sprachen (JP/FR/EN). Am Ende war die Sprachbarriere nie das Schwierige: Die eigentliche Herausforderung war, schnell zu entscheiden, während alle zusahen.
          `,
    'how.b3.title': "Das Problem dort finden, wo es wirklich liegt",
    'how.b3.detail': `
            <small>EY - Strategie- &amp; Technologieberatung</small>
            Während meines Praktikums bei EY habe ich 12 Interviews in 4 Unternehmensbereichen geführt, um zu verstehen, wie Teams KI wirklich einsetzen, und daraus Empfehlungen für Führungskräfte abgeleitet. Das Nützlichste kam daraus, zu beobachten, wie Menschen tatsächlich arbeiten. Denselben Instinkt hatte ich bei meinen eigenen Projekten: Eine Architektur-Doktorandin erzählte mir, dass Controller-Steuerung beim Entwerfen zu langsam zum Iterieren sei. Also habe ich mit zwei Freunden ein VR-Tool gebaut, das hauptsächlich per Sprache funktioniert. Was ich dabei gelernt habe: Vor Ort mit den Leuten reden, statt zu raten.
          `,
    'how.b4.title': "Rahmenbedingungen als eigentliche Aufgabe, nicht als Hindernis",
    'how.b4.detail': `
            <small>Bureau des Élèves (Studierendenrat) der Télécom Paris</small>
            Mit meinem Team war ich für Budget und Logistik einer 20.000-€-Reise für 90 Personen verantwortlich. Festes Budget, feste Termine - und mehr Wünsche, als das Budget hergab: Die eigentliche Arbeit bestand also darin, zu entscheiden, was am wichtigsten war, und den Rest sauber zu streichen. Rahmenbedingungen sind nicht der lästige Teil eines Projekts; oft sind sie es, die zur eigentlichen Entscheidung zwingen.
          `,

    'portfolio.h2': "Portfolio",
    'portfolio.readMore': "die Überlegung ↓",
    'portfolio.lightboxClose': "schließen",
    'portfolio.expandVideo': "vergrößern",
    'portfolio.showLess': "ausblenden ↑",
    'portfolio.labelProblem': "Das Problem",
    'portfolio.labelTargetUser': "Zielgruppe",
    'portfolio.labelCompetitors': "Bestehende Alternativen",
    'portfolio.labelInsight': "Die Erkenntnis",
    'portfolio.labelSolution': "Meine Lösung",
    'portfolio.labelFeedback': "Feedback bisher",
    'portfolio.labelImpact': "Wirkung",

'portfolio.p1.title': "Recette - Soziales Netzwerk für Fotobearbeitung",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - Soloprojekt, geschlossene Beta",
    'portfolio.p1.intro1': "Ich bearbeite Fotos als Hobby und laufe dabei immer wieder in dasselbe Problem: Man kann einen Look ewig bewundern, ohne je herauszufinden, wie er entstanden ist. Das <i>Wie</i> bleibt in der App eingesperrt, oder im Kopf desjenigen, der ihn gebaut hat.",
    'portfolio.p1.intro2': "Deshalb habe ich Recette gebaut- ein soziales Netzwerk für Fotobearbeitung, das auf einer einzigen Wette aufbaut: die Bearbeitung als kopierbares <i>Rezept</i> zu behandeln. Man scrollt durch den Feed, entdeckt einen Look, und wendet ihn direkt aufs eigene Foto an. Der Kern des Produkts ist, die Lücke zwischen <i>ich wünschte, meins sähe so aus</i> und dem tatsächlichen Ergebnis zu schließen.",
    'portfolio.p1.problem': "Einen guten Foto-Look kann man sofort erkennen; ihn nachzubauen ist eine ganz andere Sache. Die Technik dahinter geht in dem Moment verloren, in dem das Bild auf Social Media landet.",
    'portfolio.p1.targetUser': "Hobby-Fotobearbeiter:innen, die Bearbeitung bereits als Handwerk verstehen: Sie screenshotten Looks, die ihnen auf Social Media gefallen, geben dann aber auf, wenn sie versuchen, sie nachzubauen.",
    'portfolio.p1.competitors': "VSCO und Lightroom erlauben zwar, Presets zu speichern und zu teilen. Aber als lose Dateien, getrennt von dem Foto, das sie inspiriert hat. Man kann nirgends einen Look sehen, den man liebt, und mit einem Tap sein genaues Rezept bekommen. In der Praxis sieht der Workaround heute so aus: Screenshot machen oder in den Kommentaren nach dem Preset fragen.",
    'portfolio.p1.insight': "Die meisten Foto-Apps teilen das Ergebnis: das fertige Bild. Aber das eigentlich Wertvolle, das Übertragbare, ist die Transformation. Mein erster Reflex ging Richtung Preset-Marktplatz: statische Looks zum Anwenden, im Grunde ein Filterpaket. Das scheiterte schon in den ersten Skizzen. Ein Filter ist starr, er passt sich nicht ans jeweilige Foto an. Der Durchbruch kam, als mir die eigentliche Form des Problems klar wurde: Jemand fragt <i>wie hast du diesen Look hinbekommen?</i>, und die ehrliche Antwort ist ein ganzer Absatz voller Einstellungen, den niemand von Hand nachbauen wird. Genau diese Lücke - zwischen einen Look bewundern und ihn tatsächlich reproduzieren können - ist das Produkt.",
    'portfolio.p1.solution': "Ich habe das <i>Rezept</i> zum zentralen Objekt der App gemacht: Feed, Profil und Editor mussten Bearbeitungen lesbar und remixbar zeigen, nicht bloß fertige Bilder. Die gesperrten Ebenen (inspiriert von VSCO) waren eine bewusste Einschränkung: Nutzer:innen können die Bearbeitung anderer nicht bis auf die Rohwerte auseinandernehmen. Maximale Remixbarkeit wurde zugunsten der Namensnennung geopfert. Und ich habe mich entschieden, Bearbeitungen mit Skia-Shadern direkt auf dem Gerät laufen zu lassen statt über ein einfacheres serverseitiges Rendering, weil eine soziale Schleife stirbt, sobald sie Nutzer:innen warten lässt. Ein Kompromiss, den ich eingegangen bin: Ich habe eine vollständige Gamification-Ökonomie entworfen: Punkte fürs Posten, fürs Gespeichertwerden, und ein Shop, um sie auszugeben. Dann habe ich mich entschieden, sie nicht komplett auszurollen. Frühe Modellierungen zeigten, dass sie eine Dynamik erzeugen würde, in der die Ersten immer reicher werden: Frühe Nutzer:innen bauen einen Vorsprung auf, Neueinsteiger:innen kommen nicht mehr rein - das Gegenteil dessen, was ein Entdeckungs-Feed leisten soll.",
    'portfolio.p1.feedback': "Noch in geschlossener Beta. Das klarste Signal kommt bisher aus dem tatsächlichen Nutzungsverhalten, nicht aus einer breiten Umfrage. Retention ist die Zahl, die ich am genauesten beobachte, und Gamification das aktuelle Experiment, um sie zu verbessern. Wer das hier liest und Beta-Tester:in werden möchte: gerne melden!",
    'portfolio.p1.impact': "34 Beta-Nutzer:innen (Stand Anfang Juli), mit einer Woche-1-Retention von etwa 21 %, eine Kennzahl, an der ich aktiv arbeite :)",
    'portfolio.p1.videoCaption': "Looks im Feed durchstöbern und ein Rezept auf ein neues Foto remixen",

    'portfolio.p2.title': "Plattform zur Sentiment-Analyse von Bewertungen - Interaktive Karte",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - Gruppenprojekt mit dem Sozialwissenschafts-Team der Hochschule",
    'portfolio.p2.intro1': "Das Sozialwissenschafts-Team der Hochschule kam mit einer offenen Forschungsfrage auf uns zu: Wie verändert ein Ereignis den Ruf eines Ortes über die Zeit? Schwer zu untersuchen: ein Ruf ist diffus, verstreut über Tausende Bewertungen, und ständig in Bewegung. Die Forschenden mussten ihn sehen können, nicht nur beschreiben.",
    'portfolio.p2.intro2': "Also haben wir eine interaktive Karte gebaut, die verstreute öffentliche Bewertungen in ein lesbares Signal verwandelt. Wir haben Google-Bewertungen gescrapt, per RoBERTa eine Sentiment-Analyse auf den Freitext angewandt, und alles auf einer Leaflet-Karte dargestellt. So werden ein Ereignis und seine Folgen als Muster über die Zeit lesbar. Ich habe UI/UX übernommen.",
    'portfolio.p2.problem': "Ein Wandel des Rufs ist real, aber schwer greifbar: Er ist über Tausende einzelne Meinungen verstreut, verändert sich ständig, und nichts davon wird sichtbar, wenn man Bewertungen nur einzeln liest.",
    'portfolio.p2.videoCaption': "Bildunterschrift hier einfügen",
    'portfolio.p2.targetUser': "Die Forschenden des Sozialwissenschafts-Teams, die Muster in der öffentlichen Meinung über die Zeit hinweg erkennen mussten.",
    'portfolio.p2.competitors': "Fertige Bewertungs-Dashboards (Googles eigener Durchschnitt, TripAdvisor-artige Aggregatoren) zeigen nur einen statischen Wert (und nicht, wie er sich über Zeit oder Raum verändert). Die manuelle Alternative wäre gewesen, Bewertungen einzeln durchzulesen und das Sentiment von Hand zu zählen. Präzise, aber viel zu langsam, um ein Muster über Tausende Bewertungen hinweg zu erkennen.",
    'portfolio.p2.insight': "Die erste Version zeigte eine durchgehende Heatmap, die autoritativ wirkte, es aber nicht war. Eine Wärmefläche unterstellt Interpolation über den Raum. Die zugrundeliegenden Daten sind aber diskrete, ungleichmäßig verteilte Bewertungspunkte. Ein dichter Innenstadtblock und ein dünn besiedeltes Wohnviertel haben nicht dasselbe statistische Gewicht. Der Farbverlauf codierte also die Datenmenge, als wäre sie <i>wie stark ist das Sentiment hier</i>. Die Lösung: einzelne Marker, deren Größe und Farbe Dichte und Intensität getrennt abbilden, statt beides in einer einzigen irreführenden Farbe zu vermischen.",
    'portfolio.p2.solution': "Wir haben Google-Bewertungen gescrapt, eine RoBERTa-Sentiment-Analyse auf den eigentlichen Text angewandt (nicht nur auf Sternebewertungen), und alles auf einer Leaflet-Karte mit Jahres-Schieberegler und Schieberegler für den Mittelungszeitraum dargestellt; damit Veränderung über die Zeit das Erste ist, was man sieht. Die schwierigere Design-Entscheidung war, wie schon erwähnt, dem Drang zu widerstehen, die Daten zu glätten. Was wir bewusst nicht gebaut haben: Unterstützung für mehrere Städte oder eine öffentliche Version. Das Projekt war eng auf eine Forschungsfrage für ein Viertel zugeschnitten, und es zu verallgemeinern hätte die Jahr-für-Jahr-Präzision geopfert, die den eigentlichen Sinn der Sache ausmachte.",
    'portfolio.p2.mediaConceptCaption': "Bildunterschrift hier einfügen",
    'portfolio.p2.mediaRealCaption': "Bildunterschrift hier einfügen",

    'portfolio.p3.title': "Sprachgesteuertes VR-Architekturstudio",
    'portfolio.p3.small': "Unity, Meta Quest, Gemini API - Gruppenprojekt",
    'portfolio.p3.intro1': "Angefangen hat alles mit einem Gespräch mit einer Architektur-Doktorandin, die beschrieb, wie langsam es ist, an einem 3D-Gebäudeentwurf zu iterieren. Der Engpass war die Reibung, die Ideen schnell genug in eine greifbare Form zu bringen.",
    'portfolio.p3.intro2': "Also haben wir ein VR-Studio gebaut, in dem Architekt:innen ihre Prototypen im Raum formen, mit einer zentralen Entscheidung: Controller durch Sprache zu ersetzen. Jemandem, der nicht spielt, zwei Quest-Controller in die Hand zu drücken und flüssige 3D-Manipulation zu erwarten, ist schon viel verlangt. Die Bedienung wird selbst zum Hindernis. Sprache umgeht das: Man beschreibt, was man will, und die Oberfläche tritt fast komplett in den Hintergrund. So passt sich das Tool seinen echten Nutzer:innen an, statt von ihnen zu verlangen, Gamer zu werden. Ich habe mich auf das Interaktionsdesign konzentriert.",
    'portfolio.p3.problem': "An einem 3D-Gebäudekonzept zu iterieren ist langsam. Der Engpass ist die Reibung, Ideen schnell in eine darstellbare 3D-Form zu bringen, besonders für Architekt:innen, die mit 3D-Software und VR-/Gaming-Steuerungen wenig vertraut sind.",
    'portfolio.p3.media1Caption': "Design-Phase: Ich habe eine von Gemini erstellte Stichwort-Zusammenfassung hinzugefügt, damit Nutzer:innen sehen, was das System aus ihrer Eingabe <i>verstanden</i> hat.",
    'portfolio.p3.media2Caption': "Generierungs-Phase: Die Oberfläche, nachdem das System aus der an Gemini gesendeten Sprache zwei Prototyp-Optionen erzeugt hat.",
    'portfolio.p3.targetUser': "Technische Profis (Architekt:innen, Architekturstudierende in der frühen Konzeptphase) sowie designinteressierte Amateur:innen; nicht zwingend Menschen, die mit spielähnlichen oder 3D-Steuerungen vertraut sind.",
    'portfolio.p3.competitors': "Klassische Werkzeuge wie Rhino oder SketchUp sind präzise, verlangen aber selbst für frühe Konzeptarbeit recht genaue Eingaben, was schnelles Iterieren bremst. Der manuelle Workaround bleibt ein physisches Massenmodell aus Schaumstoff oder Karton. Bestehende VR-Design-Tools wie Gravity Sketch lösen das Problem im Raum arbeiten, setzen aber weiterhin auf Handcontroller, und führen damit genau die Hürde wieder ein, die wir für nicht-gamende Architekt:innen beseitigen wollten.",
    'portfolio.p3.insight': "Die erste Version setzte für gängige Aktionen: Wandtyp wählen, Abmessung anpassen, Material austauschen, noch auf Menüs, das übliche VR-App-Muster. Das kämpfte gegen das Medium: Architekt:innen versuchten, in Echtzeit räumlich zu denken und zu iterieren, und jeder Ausflug ins Menü unterbrach diesen Fluss. Uns wurde klar, dass die Interaktionskosten selbst das Problem waren. Sprache, geleitet über Gemini, ließ die Nutzer:innen eine Änderung in normalen Worten beschreiben, statt sich durch eine Hierarchie zu klicken.",
    'portfolio.p3.solution': "Wir haben ein VR-Studio gebaut, in dem die Nutzer:innen beschreiben, was sie wollen, und die Gemini API diese lockere natürliche Sprache in strukturierte 3D-Aktionen übersetzt, mit einer Stichwort-Zusammenfassung, die zeigt, was das System verstanden hat, bevor man bestätigt. Das hieß, für Mehrdeutigkeit und Absicht zu gestalten statt für präzise Eingaben. Der Großteil der eigentlichen Arbeit bestand darin, das System tolerant dafür zu machen, wie Menschen Dinge wirklich formulieren: was wir nur durch 7 Design-Iterationen mit 9 Nutzer:innen herausfanden. Genauso wichtig war, was wir bewusst nicht gebaut haben: Mehrbenutzer-Zusammenarbeit und wirklich freie Spracheingabe. Wir haben Sprache über Gemini geleitet, den Intentionsraum aber trotzdem eingegrenzt, Bandbreite gegen Zuverlässigkeit getauscht, bei den Befehlen, die wirklich zählten.",
    'portfolio.p3.feedback': "Das eindeutigste Feedback war verhaltensbasiert: Zuzusehen, wie jemand an einem Befehl scheitert, den wir für offensichtlich hielten, war aufschlussreicher als alles, was danach gesagt wurde. Der <i>offensichtliche</i> Befehl war es beim ersten Versuch fast nie.",

    'portfolio.p4.title': "Bildverarbeitung und Mechatronik für Menschen mit Sehbehinderung",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - Top 3 % beim TIPE (landesweiter Wettbewerb), Note 20/20",
    'portfolio.p4.intro1': "2024 stand der TIPE-Wettbewerb unter dem Thema Sport. Statt wie die meisten um mich herum auf Leistungsanalyse zu setzen, habe ich mir eine andere Frage gestellt: Wer kann ein Spiel heute nicht genießen? Sehbehinderte Zuschauer:innen hören die Stimmung im Stadion, verlieren aber den Faden, wo der Ball sich tatsächlich befindet.",
    'portfolio.p4.intro2': "Also habe ich ein System gebaut, das den Ball erkennt und seine Position über das Tastgefühl vermittelt statt über das Sehen: KI-basierte Ballerkennung und Felderkennung, übersetzt in etwas, das man fühlt statt sieht.",
    'portfolio.p4.problem': "Sehbehinderte Zuschauer:innen bekommen Klang und Atmosphäre eines Stadions mit, aber genau die eine Information, die das Spiel eigentlich erklärt (also wo sich der Ball gerade befindet) geht verloren.",
    'portfolio.p4.mediaCoverCaption': "Die Kernidee des Projekts",
    'portfolio.p4.mediaAlgorithmCaption': "Vollständiger Algorithmus",
    'portfolio.p4.mediaHardwareCaption': "Die tatsächliche Hardware - der sensorische Teil für die Nutzer:innen misst nur 12 cm.",
    'portfolio.p4.mediaDetectionCaption': "Ballerkennung.",
    'portfolio.p4.mediaPositionsCaption': "Lokalisierungsfehler über die getesteten Azimut-/Elevations-Kamerapositionen - minimaler Fehler 0,035 m.",
    'portfolio.p4.targetUser': "Blinde und sehbehinderte Fußballzuschauer:innen im Stadion, die Positionsinformationen schnell genug brauchen, um eine Spielszene in Echtzeit mitzuverfolgen.",
    'portfolio.p4.competitors': "Audiokommentar gibt es in den meisten Stadien bereitss, aber das ist ein Mensch, der in Sätzen erzählt, keine kontinuierlichen Positionsdaten. Es gibt eine inhärente Verzögerung, und er kann nicht Sekunde für Sekunde vermitteln, wo genau auf dem Feld sich der Ball befindet. Der übliche Workaround heute ist eine sehende Begleitperson, die daneben sitzt und leise die Ballposition in Echtzeit durchgibt.",
    'portfolio.p4.insight': "Mein erster Durchlauf nutzte ein schwereres, höher auflösendes Erkennungsmodell. Ich habe zunächst der Genauigkeit hinterhergejagt, Latenz war zweitrangig. Das brach zusammen, sobald es auf dem tatsächlichen Edge-/Arduino-Pfad laufen musste: Zwei Sekunden Verzögerung reichen, um das gesamte System irreführend zu machen, weil man dann eine bereits vergangene Aktion spüren würde. Der Durchbruch war die Erkenntnis, dass Genauigkeit nur zählt, wenn sie rechtzeitig ankommt. Deshalb habe ich hohe Präzision gegen Bildrate und Latenz getauscht, was mich zu einem YOLOv9-Modell mit niedrig aufgelöstem Input geführt hat.",
    'portfolio.p4.solution': "Ich habe Latenz zur wichtigsten Einschränkung gemacht und dafür eine vertretbare Fehlermarge akzeptiert: 180 ms Inferenzzeit und etwa 6 Meter Lokalisierungsfehler, umgewandelt in eine haptische Bande, die man unter den Fingern auf einem 12-cm-Sensorboard spürt. Dieser Fehler von ±6 m reicht aus, um <i>Ball am linken Flügel, nahe dem Strafraum</i> zu vermitteln (da das physische Board ohnehin klein ist). Dieselbe Logik galt für die Hardware: Ich habe 60 Kamerapositionen getestet, um den tatsächlichen Sweet Spot zwischen Abdeckung und Genauigkeit zu finden, statt einen offensichtlich guten Winkel zu erraten. Was ich nicht gebaut habe: ein System zur Verfolgung aller Spieler:innen. Das hätte Latenz und Komplexität für Informationen hinzugefügt, die sich blinde Zuschauer:innen teils schon aus Publikumslärm und Kommentar erschließen können.",
    'portfolio.p4.impact': "Landesweit unter den besten 3 % beim TIPE-Forschungswettbewerb für Ingenieurstudierende in Frankreich platziert, mit 20/20 bewertet. An all die verschiedenen Menschen rund um den Sport zu denken (Spieler:innen, Zuschauer:innen...) hat mich zu diesem Projekt geführt. Von <i>Wer wird ausgeschlossen?</i> auszugehen, ist seitdem meine Art, Probleme auszuwählen.",
    'cv.h2': "Lebenslauf",
    'cv.intro': "Alles oben Genannte, zusammengefasst auf einer Seite.",
    'cv.download': "Lebenslauf herunterladen ↓",
    'cv.arrowText': "Schreibt mir gerne!",

    'creative.h2': "Weitere Projekte",
    'creative.intro': "Neben der beruflichen Seite liebe ich alles, wobei ich kreativ werden kann! Hier sind ein paar persönliche Projekte :) Klickt drauf, um sie im Vollbild zu sehen!",
    'creative.thingsIMake': "Was ich gestalte",
    'creative.thingsIShoot': "Was ich aufnehme",
    'creative.thingsIDo': "Was ich sonst mache",
    'creative.thingsIDoText': "Nach 12 Jahren klassischem Ballett habe ich vor Kurzem mit Eiskunstlauf angefangen. Außerdem liebe ich Musik - ob Klavier spielen oder RAYE und a6el hören - und schöne Kuchen backen :) ",

    'creative.viewOnCanva': "Auf Canva ansehen ↗",
    'creative.viewOnInstagram': "Auf Instagram ansehen ↗",
    'creative.viewOnDrive': "Auf Drive ansehen ↗",

    'creative.alpha.title': "Plaquette Alpha",
    'creative.alpha.desc': "Ich habe etwa ein Drittel des Magazins gestaltet, das den Campus und das Studierendenleben der Hochschule vorstellt - gedacht für Bewerber*innen aus den Vorbereitungsklassen, gedruckt in etwa 3.000 Exemplaren.",
    'creative.guide.title': "Barcelona-Reiseführer",
    'creative.guide.desc': "Im Rahmen meiner Rolle im Studierendenrat habe ich mitgeholfen, eine Reise nach Barcelona für 90 Studierende zu organisieren, und dieses Booklet gestaltet, um alle bestmöglich zu begleiten.",
    'creative.poster.title': "Eventplakate",
    'creative.poster.desc': "Als Mitglied dreier Vereine an der Télécom Paris habe ich verschiedene Plakate zur Bewerbung von Events gestaltet.",
    'creative.website.title': "Diese Website",
    'creative.website.desc': "Design des Kükens, individuelle Icons, 3D-Modellierung und Animation, um dieses Portfolio zum Leben zu erwecken!",

    'creative.barcelonaRecap.title': "Rückblick: Barcelona-Reise",
    'creative.barcelonaRecap.desc': "Mein Rückblick-Video zu unserer vom Studierendenrat organisierten Barcelona-Reise.",
    'creative.aix.title': "Sommer im Süden",
    'creative.aix.desc': "Ein kurzes Reisetagebuch aus dem Süden, mit Freund*innen. Aufnahmen zusammen mit einem Freund gedreht.",
    'creative.flash.title': "Blitzlicht-Fotografie",
    'creative.flash.desc': "Y2K-inspirierte Serie, gedreht und bearbeitet mit Freund*innen an öffentlichen Orten rund um das Plateau de Saclay.",
    'creative.wei.title': "Erstsemester-Willkommenswochenende der Télécom Paris",
    'creative.wei.desc': "Aufnahmen meines Audiovisual-Clubs, die ich anschließend geschnitten habe.",
    'creative.film.title': "Analogfotografie",
    'creative.film.desc': "Ein paar Fotos von Reisen durch Frankreich und Europa mit meiner analogen Kamera, bearbeitet mit Lightroom.",
    'creative.ski.title': "Rückblick: Ski-Wochenende",
    'creative.ski.desc': "Ein Solo-Projekt für den Studierendenrat, von Anfang bis Ende selbst gedreht und geschnitten.",

    'footer.text': "Mit Liebe, three.js und einem sehr engagierten Küken gemacht. Danke fürs Lesen! ",
    nextSectionTitles: ['über mich', 'Werdegang', 'meine Arbeitsweise', 'Portfolio', 'Lebenslauf', 'weitere Projekte', null, null],
  },
};

// snapshot every i18n-managed element's original (English) content once,
// up front, so switching back to English is a restore rather than a
// second dictionary to keep in sync with the HTML
const I18N_NODES = Array.from(document.querySelectorAll('[data-i18n]')).map((el) => ({
  el,
  key: el.dataset.i18n,
  attr: el.dataset.i18nAttr || null,
  original: el.dataset.i18nAttr ? el.getAttribute(el.dataset.i18nAttr) : el.innerHTML,
}));
const NEXT_SECTION_TITLE_EN = NEXT_SECTION_TITLE.slice();
let currentLang = localStorage.getItem('portfolioLang') || 'en';

function applyTranslations(lang) {
  document.documentElement.lang = lang;
  const dict = translations[lang];
  I18N_NODES.forEach(({ el, key, attr, original }) => {
    const value = (dict && dict[key] !== undefined) ? dict[key] : original;
    if (attr) el.setAttribute(attr, value);
    else el.innerHTML = value;
  });
  const titles = (dict && dict.nextSectionTitles) || NEXT_SECTION_TITLE_EN;
  NEXT_SECTION_TITLE.splice(0, NEXT_SECTION_TITLE.length, ...titles);
  updateNextSectionButton();
  document.querySelectorAll('#portfolio .project-toggle').forEach((btn) => {
    const isOpen = btn.closest('.project').classList.contains('is-open');
    btn.textContent = isOpen
      ? ((dict && dict['portfolio.showLess']) || 'hide thinking ↑')
      : ((dict && dict['portfolio.readMore']) || 'the thinking ↓');
  });
  currentLang = lang;
  localStorage.setItem('portfolioLang', lang);
  // cv card height can shift a little between languages; keep the arrow
  // anchored to its actual edge rather than wherever it was pre-switch
  layoutCvArrow();
}

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
    applyTranslations(opt.dataset.lang);
  });
});
document.addEventListener('click', (e) => {
  if (!langSwitcher.contains(e.target)) {
    langSwitcher.classList.remove('open');
    langBtn.setAttribute('aria-expanded', 'false');
  }
});

// restore whatever language was picked last time
if (currentLang !== 'en') {
  const savedOption = document.querySelector(`.lang-option[data-lang="${currentLang}"]`);
  if (savedOption && translations[currentLang]) {
    document.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('active'));
    savedOption.classList.add('active');
    langBtnImg.src = savedOption.dataset.flag;
    applyTranslations(currentLang);
  }
}

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
