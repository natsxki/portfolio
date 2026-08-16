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
      ? (dict['portfolio.showLess'] || 'show less ↑')
      : (dict['portfolio.readMore'] || 'read more ↓');
  });
});

// per-project "next: ..." shortcut - jumps to the next project card, not a
// page-section jump like next-section-btn and not listed in the page nav
document.querySelectorAll('#portfolio .project-next[data-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    'nav.about': "à propos",
    'nav.howIWork': "ma façon de travailler",
    'nav.portfolio': "portfolio",
    'nav.cv': "cv",
    'nav.creative': "autres projets créatifs",
    'nav.nextSection': "section suivante",
    'nav.next': "suivant",

    'hero.hello': "langues · systèmes · interfaces",
    'hero.h1': "Hello, moi c'est Lylia !",
    'hero.scrollHint': "En savoir plus sur moi :) ↓",

    'about.h2': "Enchantée !",
    'about.intro': "Entre le français et le japonais, puis l'allemand et l'anglais, j'ai appris très tôt que la meilleure communication ne demande aucune traduction. Je cherche la même évidence dans ce que je construis : à la frontière de l'ingénierie et du design, prendre un problème flou et le transformer en une décision claire, sur laquelle toute une équipe peut avancer.",
    'about.status': 'Actuellement stagiaire en développement logiciel chez ArianeGroup, je recherche un <strong>stage de Product Manager</strong>, débutant entre mars et juin 2027.',

    'timeline.h2': "parcours",
    'timeline.academics': "Études",
    'timeline.professional': "Expérience professionnelle",
    'timeline.msc': "Diplôme d'ingénieur, <a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a> (<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>). <br><br>Majeures : Data Science & IA + Graphisme 3D & Interactions (IHM)",
    'timeline.arianegroup.company': "ArianeGroup",
    'timeline.arianegroup.role': "Stagiaire en développement logiciel",
    'timeline.dataannotation.company': "DataAnnotation",
    'timeline.dataannotation.role': "Évaluatrice de modèles IA (temps partiel)",
    'timeline.ey.company': "EY",
    'timeline.ey.role': "Stagiaire en conseil stratégie &amp; tech",
    'timeline.joc.company': "Comité Olympique Japonais",
    'timeline.joc.role': "Assistante du Président",

    'how.h2': "Ma façon de travailler",
    'how.b1.title': "Lancer ou ne pas lancer",
    'how.b1.detail': `
            <small>Comète (club audiovisuel de Télécom Paris) - Secrétaire générale</small>
            Notre club audiovisuel, Comète, publie plus de 50 000 photos d'événements par an, sur un site ouvert à tous les étudiants. Retrouver celles où on apparaît peut vite devenir chronophage. J'ai donc prototypé une fonctionnalité pour que chacun puisse se retrouver dans les archives grâce à la reconnaissance faciale. L'outil fonctionnait, mais en me renseignant sur les enjeux liés aux données biométriques, j'ai décidé de ne pas le lancer. La décision produit la plus difficile que j'ai prise jusqu'ici, ce n'est pas quelque chose que j'ai construit : c'est ce que j'ai choisi de ne pas lancer.
          `,
    'how.b2.title': "Des décisions réelles, en direct, en plusieurs langues",
    'how.b2.detail': `
            <small>Jeux Olympiques de Paris 2024</small>
            En tant qu'assistante du président du Comité Olympique Japonais pendant les Jeux de Paris 2024, je coordonnais la délégation japonaise avec les organisateurs locaux, au milieu de plannings mouvants et de priorités contradictoires. Tout se jouait en direct, dans 3 langues (JP/FR/EN). Au fond, la barrière de la langue n'a jamais été le plus dur : le vrai défi, c'était de trancher vite, sous le regard de tous.
          `,
    'how.b3.title': "Trouver le problème là où il se trouve vraiment",
    'how.b3.detail': `
            <small>EY - Conseil en stratégie et technologie</small>
            Pendant mon stage chez EY, j'ai mené 12 entretiens dans 4 pôles de l'entreprise sur la façon dont les équipes adoptent vraiment l'IA, que j'ai ensuite synthétisés en recommandations pour les managers. Le plus utile ne venait jamais du brief : il venait d'observer comment les gens travaillent réellement. Même réflexe sur mes propres projets : un doctorant en architecture m'a dit que concevoir à la manette était trop lent pour itérer, alors j'ai construit, avec deux amis, un outil VR piloté surtout par la voix. J'ai appris à quel point ça compte d'aller parler aux gens sur le terrain plutôt que de deviner.
          `,
    'how.b4.title': "Les contraintes comme le vrai travail, pas comme l'obstacle",
    'how.b4.detail': `
            <small>Bureau des Élèves de Télécom Paris</small>
            Avec mon équipe, nous étions responsables du budget et de la logistique d'un voyage de 20 000 € pour 90 personnes. Budget fixe, dates fixes, et plus d'envies que le budget ne pouvait en satisfaire : le vrai travail, c'était donc de décider ce qui comptait le plus et de couper le reste proprement. Les contraintes ne sont pas la partie pénible d'un projet ; ce sont souvent elles qui forcent la vraie décision.
          `,

    'portfolio.h2': "Portfolio",
    'portfolio.readMore': "lire plus ↓",
    'portfolio.lightboxClose': "Fermer l'image",
    'portfolio.expandVideo': "Agrandir la vidéo",
    'portfolio.showLess': "voir moins ↑",
    'portfolio.nextProject': "suivant :",

    'portfolio.p1.title': "Recette - Réseau social de retouche photo",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - Appli conçue solo, en beta fermée",
    'portfolio.p1.summary': "Et si c'était les paramètres de retouche qu'on partageait, et pas seulement la photo ?",
    'portfolio.p1.intro1': 'Je retouche des photos en amateur, et j\'ai un peu toujours le même problème : on peut admirer un rendu pendant des heures sans jamais réussir à le reproduire. Le « comment » reste enfermé dans l\'appli, ou dans la tête de la personne qui l\'a créé.',
    'portfolio.p1.intro2': 'J\'ai donc créé Recette, un réseau de retouche photo avec un pari central : traiter la retouche comme une recette copiable, pas comme un sous-produit caché. On repère un rendu qu\'on aime dans le fil, et on le réapplique sur sa propre photo. Le but de l\'appli: réduire l\'écart entre « j\'aimerais que ma photo ressemble à ça » et y arriver pour de vrai.',
    'portfolio.p1.more1': "La décision de traiter la recette comme un objet à part entière, a façonné tout mon produit. C'est aussi ce qui transforme un simple outil de retouche en une boucle sociale.",
    'portfolio.p1.more2': "Je me suis inspirée du système de calques verrouillés de VSCO : on peut ajuster l'intensité du filtre choisi. J'ai aussi fait le choix de faire directement tourner les retouches sur l'appareil de l'utilisateur (ordinateur/téléphone) avec des shaders Skia, pour que chaque ajustement soit instantané. Une boucle sociale meurt vite dès qu'elle donne une impression d'attente.",
    'portfolio.p1.more3': "L'appli est pour l'instant en beta fermée. Je teste surtout la rétention, et je cherche à l'améliorer via la gamification.",
    'portfolio.p1.videoCaption': "Parcours du fil d'actualité et remix d'une recette sur une nouvelle photo",

    'portfolio.p2.title': "Plateforme d'analyse de sentiment - Carte interactive",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - Projet de groupe, avec l'équipe de sciences sociales de l'école",
    'portfolio.p2.summary': "Comment voir évoluer la réputation d'un lieu après un événement ?",
    'portfolio.p2.intro1': "L'équipe de sciences sociales de l'école est venue nous voir avec une question de recherche ouverte : comment un événement fait-il évoluer la réputation d'un lieu ? La réputation est déjà difficile à évaluer : on pourrait uniquement se baser sur les notes Google Reviews - mais elles existent par milliers, et les utilisateurs attribuent une note de manière subjective. Par exemple, \"Bien\" peut être équivalent à 3 étoiles ou 4, selon l'utilisateur.",
    'portfolio.p2.intro2': "Nous avons donc construit une carte interactive qui transforme les <i>commentaires</i> des avis publics en un signal quantitatif, lisible dans le temps et l'espace. Nous avons scrapé des avis Google, fait tourner une analyse de sentiment avec un modèle RoBERTa pour transformer le texte libre en valeurs exploitables, puis affiché le tout sur une carte Leaflet, pour qu'un événement et ses répercussions se lisent comme un motif dans le temps. Je me suis chargée de l'UI/UX.",
    'portfolio.p2.videoCaption': "Navigation dans l'interface.",
    'portfolio.p2.more1': "Le vrai problème de conception, c'était la lisibilité : le temps, la géographie et le sentiment font ensemble trois dimensions à la fois. L'évolution dans le temps était justement ce qui comptait le plus pour la recherche. La décision clé a donc été de concevoir pour la seule chose que les chercheurs avaient vraiment besoin de percevoir : comment un lieu change, dans le temps.",
    'portfolio.p2.mediaConceptCaption': "Concept original.",
    'portfolio.p2.mediaRealCaption': "Version finale.",
    'portfolio.p2.more2': "Le plus intéressant dans ce projet n'était ni le scraping, ni le modèle : c'était de partir d'une question humaine floue pour en faire un outil de recherche qui rend les réponses visible.",

    'portfolio.p3.title': "Studio VR d'architecture piloté par la voix",
    'portfolio.p3.small': "Unity, Meta Quest, API Gemini - Projet de groupe",
    'portfolio.p3.summary': "Prototyper un bâtiment ne devrait pas commencer par apprendre à être gamer.",
    'portfolio.p3.intro1': "Tout est parti d'une conversation avec une doctorante en architecture, qui décrivait à quel point le prototypage 3D d'un bâtiment est une étape chronophage. Le frein, ce n'est pas les idées : c'est d'arriver à vite les transformer en une forme exploitable.",
    'portfolio.p3.intro2': "Nous avons donc construit un studio en réalité virtuelle, où les architectes façonnent leurs prototypes dans l'espace, en utilisant majoritairement leur voix. L'utilisation des manettes Quest dans l'espace (pour de la modélisation 3D, par exemple) est souvent l'obstacle principal si l'utilisateur n'en a jamais utilisé. La voix contourne ce problème : on décrit ce qu'on veut oralement, et l'on obtient une première base de travail en quelques secondes. L'outil s'adapte ainsi à un large panel d'utilisateurs, expérimentés ou non. Sur ce projet, je me suis concentrée sur le design de l'interface et des interactions (UI/UX).",
    'portfolio.p3.media1Caption': "Phase de conception : Résumé par mots-clés généré par Gemini, pour montrer à l'utilisateur ce que le système a <i>compris</i> de ses descriptions.",
    'portfolio.p3.media2Caption': "Phase de génération : l'interface une fois que le système a généré les deux prototypes (à partir des descriptions orales envoyées à Gemini).",
    'portfolio.p3.more1': "Une bonne partie du travail a consisté à rendre le système tolérant à la façon dont les utilisateurs formulent les choses. Les utilisateurs se corrigent souvent oralement, s'enregistrent plusieurs fois de suite, ou bégaient. Pour montrer à l'utilisateur ce que le système a <i>compris</i> de ses descriptions, j'ai ajouté dans l'UI un résumé de celles-ci en mots-clés (à l'aide de Gemini).",
    'portfolio.p3.more2': "Nous avons mené 7 itérations de design avec 9 utilisateurs avant d'arriver à notre version finale. Ce nombre d'itérations me rend particulièrement fière ; voir un utilisateur buter sur une commande que l'on croyait évidente, puis la retravailler, nous a permis de construire une interface intuitive. La commande « évidente » l'était rarement autant qu'on le pensait.",

    'portfolio.p4.title': "Traitement d'images et mécatronique pour la cécité",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - Top 3% au TIPE (échelle nationale), noté 20/20",
    'portfolio.p4.summary': "Un spectateur aveugle peut-il suivre un match de football en temps réel ?",
    'portfolio.p4.intro1': 'En 2024, le TIPE avait pour thème le sport. Je me suis intéressée à la question suivante : qui ne peut pas profiter d\'un match aujourd\'hui ? Les spectateurs malvoyants entendent l\'ambiance du stade, mais perdent le fil de là où se trouve vraiment le ballon.',
    'portfolio.p4.intro2': "J'ai donc construit un système de suivi qui repère le ballon dans un flux d'images et transmet sa position par le toucher plutôt que par la vue : reconnaissance du ballon par IA et détection du terrain, traduites en quelque chose qui se ressent au lieu de se voir.",
    'portfolio.p4.mediaCoverCaption': "L'idée principale du projet",
    'portfolio.p4.more1a': 'La décision clef de mon projet : privilégier le temps réel à la précision. Un match n\'attend pas : un système précis mais en retard n\'est pas optimal, puisqu\'on ressentirait une action déjà passée. J\'ai donc fait de la latence la contrainte principale, en acceptant en échange une marge d\'erreur tolérable : 180 ms d\'inférence, ~6 m de localisation.',
    'portfolio.p4.mediaAlgorithmCaption': "Algorithme complet",
    'portfolio.p4.more1b': 'Ces 6 m sont un compromis assumé : assez précis pour transmettre, tout en restant assez rapide pour donner une vraie impression de direct. La valeur est d\'autant plus acceptable pour un système physique plutôt petit (d\'une douzaine de cm), où 6cm ne représentent plus que quelques millimètres.',
    'portfolio.p4.mediaHardwareCaption': "Le matériel réel - la partie sensorielle pour l'utilisateur ne mesure que 12 cm.",
    'portfolio.p4.more1c': 'J\'ai également testé manuellement 60 emplacements de caméra pour trouver le meilleur équilibre couverture/précision (en générant des images de simulation sur Blender depuis chaque position). Résultat qu\'on ne trouve qu\'en testant méthodiquement plutôt qu\'en devinant, même s\'il est finalement plutôt intuitif.',
    'portfolio.p4.mediaDetectionCaption': "Détection du ballon.",
    'portfolio.p4.mediaPositionsCaption': "Erreur de localisation selon les positions de caméra testées (azimut/élévation) - erreur minimale de 0,035 m.",
    'portfolio.p4.more2': 'Le fait de penser à tous les profils qui existent autour du sport (joueurs, spectateurs...), m\'a menée à ce projet. Partir de « qui est laissé de côté ? » plutôt que de « qu\'est-ce qui est techniquement \"impressionnant\" ? » reste ma manière préférée de choisir mes problèmes !',

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

    nextSectionTitles: ['à propos', 'parcours', 'ma façon de travailler', 'portfolio', 'cv', 'autres projets créatifs', null, null],
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
    'nav.next': "次へ",

    'hero.hello': "文化 · 工学 · デザイン",
    'hero.h1': "はじめまして、リリアです。",
    'hero.scrollHint': "もっと詳しく↓",

    'about.h2': "はじめまして。",
    'about.intro': "フランスと日本、二つの文化のあいだで育ち、ドイツ語や英語にも触れてきたなかで学んだのは、本当に伝わるコミュニケーションに翻訳はいらない、ということでした。この感覚を、プロダクトづくりにも活かしたいと思っています。エンジニアリング、デザイン、戦略とさまざまな領域に携わってきましたが、いちばん惹かれるのは、その境界が重なり合う部分です。曖昧でとらえどころのない問題を、チーム全員が動き出せる一つの決断へと変えていく。それが、私にとって何より大切な仕事です。",
    'about.status': '現在はArianeGroupでソフトウェアエンジニアリングのインターンをしていますが、<strong>2027年春または夏開始のプロダクトマネージャーインターンシップ</strong>を探しています。',

    'timeline.h2': "経歴",
    'timeline.academics': "学歴",
    'timeline.professional': "職歴",
    'timeline.msc': "工学修士課程 (MSc)、<a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a>(<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>)。<small>フランスを代表する工学系グランゼコールの一つ(選抜制の入学試験を経て入学)。</small><br><br>専攻:データサイエンス&AI + 3Dグラフィックス&インタラクション(HCI)",
    'timeline.arianegroup.company': "ArianeGroup",
    'timeline.arianegroup.role': "ソフトウェアエンジニアリングインターン",
    'timeline.dataannotation.company': "DataAnnotation",
    'timeline.dataannotation.role': "AI評価(パートタイム)",
    'timeline.ey.company': "EY",
    'timeline.ey.role': "戦略・ITコンサルティングインターン",
    'timeline.joc.company': "日本オリンピック委員会",
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
    'portfolio.readMore': "もっと見る ↓",
    'portfolio.lightboxClose': "画像を閉じる",
    'portfolio.expandVideo': "動画を拡大",
    'portfolio.showLess': "閉じる ↑",
    'portfolio.nextProject': "次:",

    'portfolio.p1.title': "Recette - ソーシャル写真編集アプリ",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - 個人開発、クローズドベータ",
    'portfolio.p1.summary': "写真そのものではなく、編集の「設定」をシェアできたら?",
    'portfolio.p1.intro1': "趣味で写真編集をしていると、いつも同じ壁にぶつかっていました。ある仕上がりをどれだけ眺めても、同じようには再現できない。その「やり方」が、アプリの中か、作った人の頭の中に閉じ込められたままだからです。",
    'portfolio.p1.intro2': "そこで作ったのがRecetteです。写真編集のソーシャルアプリで、核にある発想はいたってシンプル。編集を目に見えない副産物ではなく、コピーできる「レシピ」として扱う、というものです。フィードで気に入った仕上がりを見つけたら、自分の写真にそのまま適用できます。「自分の写真もこんな風になればいいのに」という憧れと、それを実際に形にすることのあいだにあるギャップを埋めるためのプロダクトです。",
    'portfolio.p1.more1': "レシピを独立したオブジェクトとして扱うという決断が、プロダクト全体の形を決めました。フィードもプロフィールもエディターも、完成した画像を見せるだけでなく、編集の中身を読み取ってリミックスできるものである必要があったのです。これこそが、単なる編集ツールをソーシャルなループへと変える鍵でした。",
    'portfolio.p1.more2': "VSCOのロックレイヤー方式からヒントを得て、レシピが構造を保ったまま再現できるようにし、選んだフィルターの強さも調整できるようにしました。また、編集はSkiaシェーダーを使って端末(パソコンやスマートフォン)側で直接処理する設計にしています。調整のたびに、その場ですぐ反映されるようにするためです。ソーシャルなループは、少しでも「待たされている」と感じた瞬間に崩れてしまうものだからです。",
    'portfolio.p1.more3': "現在はクローズドベータ中で、特にユーザーの継続率に注目しながら、ゲーミフィケーションによる改善策を探っています。",
    'portfolio.p1.videoCaption': "フィードで好みのルックを見つけ、新しい写真にレシピをリミックスする様子",

'portfolio.p2.title': "レビュー感情分析プラットフォーム - インタラクティブマップ",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - グループプロジェクト、学校の社会科学チームと共同",
    'portfolio.p2.summary': "何かが起きた後、評判の変化をどう可視化するか?",
    'portfolio.p2.intro1': "学校の社会科学チームから、ある出来事が場所の評判を時間とともにどう変えていくのか、というオープンな研究課題を持ちかけられました。これはなかなか扱いづらいテーマです。評判というものは輪郭が曖昧で、何千件もの口コミに散らばり、しかも絶えず動いているからです。彼らに必要だったのは、評判を言葉で説明することではなく、実際に「見える」形にすることでした。",
    'portfolio.p2.intro2': "そこで、ばらばらに存在する一般公開の口コミを、読み取れる信号へと変えるインタラクティブマップを構築しました。Googleレビューをスクレイピングし、RoBERTaモデルによる感情分析でフリーテキストを扱いやすい信号に変換。それをLeafletの地図上に重ねることで、ある出来事とその余波が時間の経過とともにひとつのパターンとして読み取れるようにしました。私はUI/UXを担当しました。",
    'portfolio.p2.videoCaption': "キャプションを追加",
    'portfolio.p2.more1': "本当のデザイン上の課題は「読みやすさ」でした。時間・地理・感情という3つの次元が同時に存在しているからです。そして、変化を時間の流れの中で捉えられることこそ、この研究にとって最も重要な要素でした。だからこそ、研究者たちが本当に感じ取る必要があったこと、つまり「ある場所が時間とともにどう変わるか」だけに絞ってデザインする、というのが鍵となる決断でした。",
    'portfolio.p2.mediaConceptCaption': "キャプションを追加",
    'portfolio.p2.mediaRealCaption': "キャプションを追加",
    'portfolio.p2.more2': "このようにあえて要素を絞り込んだことこそが、ただのデータの山を、研究のための道具へと変えた理由でした。面白かったのはスクレイピングやモデルそのものではなく、曖昧で人間くさい問いから出発して、その答えが見えるツールへと形にしていくプロセスだったのです。",

'portfolio.p3.title': "音声操作型VR建築スタジオ",
    'portfolio.p3.small': "Unity, Meta Quest, Gemini API - グループプロジェクト",
    'portfolio.p3.summary': "建物を設計するのに、まずゲーマーになる必要はないはず。",
    'portfolio.p3.intro1': "きっかけは、建築を学ぶ博士課程の学生との会話でした。3Dの建物デザインをプロトタイピングし、試行錯誤を重ねていく作業がいかに遅いか、という話です。ボトルネックはアイデアそのものではなく、それを素早く形にするまでの摩擦にありました。",
    'portfolio.p3.intro2': "そこで、建築家が空間の中でプロトタイプを形づくれるVRスタジオを作りました。核となる決断は、コントローラーを音声に置き換えることです。ゲームをしない人にQuestのコントローラーを2つ渡して、滑らかな3D操作を期待するのは、それだけでもうハードルが高すぎます。操作そのものが障害になってしまうのです。音声ならそれを回避できます。欲しいものを言葉で説明すれば、インターフェースはほとんど意識に上らなくなります。こうしてツールは、ユーザーにゲーマーであることを求めるのではなく、実際の使い手に寄り添う形になりました。私はインタラクションデザインを担当しました。",
    'portfolio.p3.media1Caption': "設計フェーズ:Geminiが生成したキーワード要約を加え、ユーザーの発話をシステムがどう<i>理解した</i>のかを示せるようにしました。",
    'portfolio.p3.media2Caption': "生成フェーズ:Geminiに送った発話をもとに、システムが2つのプロトタイプ案を生成した後のUIです。",
    'portfolio.p3.more1': "そして、この決断こそが、より面白い課題を生み出しました。音声を使うということは、Gemini APIを使って、あいまいな自然言語を構造化されたアクションへと変換する必要がある、ということです。これは、ボタンと機能を対応づけるのとはまったく異なる設計上の制約でした。正確な入力を前提とした設計ではなく、曖昧さの中から意図をくみ取るための設計だからです。作業の多くは、人が実際に口にする言い回しに、システムを柔軟に対応させることに費やされました。",
    'portfolio.p3.more2': "そして、その言い回しは、観察することでしか見つけられませんでした。ヘッドセットに実装する前に、9人のユーザーとともに7回のデザイン改善を重ねています。この反復の回数こそ、私が一番誇りに思っている部分です。本当の学びは、当たり前だと思っていたコマンドで誰かがつまずくのを見て、それを作り直すところから生まれたからです。そして「当たり前」のコマンドが、思っていたほど当たり前だったことは、ほとんどありませんでした。",

'portfolio.p4.title': "視覚障がい者のための画像処理とメカトロニクス",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - TIPE全国上位3%、20/20評価",
    'portfolio.p4.summary': "目の見えない観客も、サッカーの試合をリアルタイムで追えるだろうか?",
    'portfolio.p4.intro1': "2024年のTIPE(フランスの理工系グランゼコール入試の研究課題)のテーマはスポーツでした。周りの多くの学生がパフォーマンス分析に向かう中、私が立てたのは別の問いでした。いま試合を楽しめずにいるのは誰だろう?視覚に障がいのある観客は、スタジアムの熱気は耳で感じられても、ボールが実際にどこにあるのかは見失ってしまいます。",
    'portfolio.p4.intro2': "そこで、ボールの位置を視覚ではなく触覚で伝えるトラッキングシステムを構築しました。AIによるボール認識とフィールド検出を組み合わせ、「見る」情報を「感じる」情報へと変換しています。",
    'portfolio.p4.mediaCoverCaption': "プロジェクトの中心となるアイデア",
    'portfolio.p4.more1a': "すべてを方向づけた決断は、精度よりもリアルタイム性を優先することでした。試合は待ってくれません。正確でも遅れて届く情報には意味がなく、それではすでに終わったプレーを感じることになってしまいます。そこで、遅延こそを最も重要な制約に据え、その代わりとして許容できる範囲の誤差を受け入れました:推論時間180ミリ秒、位置精度は約6メートルです。",
    'portfolio.p4.mediaAlgorithmCaption': "アルゴリズム全体",
    'portfolio.p4.more1b': "この6メートルは意図的な妥協点です。情報を伝えるのに十分な精度でありながら、本当にライブだと感じられるだけの速さも保っています。",
    'portfolio.p4.mediaHardwareCaption': "実際のハードウェア - ユーザーに提示する感覚部分はわずか12cmです。",
    'portfolio.p4.more1c': "ハードウェアの設計にも同じ考え方を反映し、カバー範囲と精度の最適なバランスを見つけるために60通りのカメラ配置を検証しました。これは、推測ではなく体系的なテストを重ねることでしか見つけられない種類のトレードオフです。",
    'portfolio.p4.mediaDetectionCaption': "ボール検出。",
    'portfolio.p4.mediaPositionsCaption': "検証した方位角・仰角のカメラ配置ごとの位置誤差 - 最小誤差は0.035m。",
    'portfolio.p4.more2': "選手や観客など、スポーツを取り巻くさまざまな立場の人たちを想像したことが、このプロジェクトの出発点でした。「技術的にすごいことは何か」ではなく「取り残されているのは誰か」から始めること。それが今も変わらない、私の課題の選び方です。",

    'cv.h2': "履歴書",
    'cv.intro': "これまでの内容を1ページに凝縮しました。",
    'cv.download': "履歴書をダウンロード ↓",
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
    'creative.flash.desc': "Y2Kスタイルにインスパイアされたシリーズ。友人たちとサクレー高原周辺の公共の場で撮影・編集しました。",
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
    'nav.about': "über mich",
    'nav.howIWork': "meine Arbeitsweise",
    'nav.portfolio': "Portfolio",
    'nav.cv': "Lebenslauf",
    'nav.creative': "weitere Projekte",
    'nav.nextSection': "zum nächsten Abschnitt scrollen",
    'nav.next': "weiter",

    'hero.hello': "Kulturen · Technik · Design",
    'hero.h1': "Hallo, ich bin Lylia!",
    'hero.scrollHint': "um mehr über mich zu erfahren ↓",

    'about.h2': "Schön, dich kennenzulernen c:",
    'about.intro': "Aufgewachsen zwischen der französischen und der japanischen Kultur, mit Deutsch und Englisch in der Schule dazu, habe ich früh gelernt: Die beste Kommunikation kommt ganz ohne Übersetzung aus. Diesen Instinkt wende ich auch auf Produkte an - ich habe mich mit Engineering, Design und Strategie beschäftigt, und was mich wirklich reizt, ist die Schnittstelle dazwischen. Ein unübersichtliches, vages Problem in eine Entscheidung zu verwandeln, auf die ein ganzes Team aufbauen kann - das ist es, was mich antreibt.",
    'about.status': '<strong>Aktuell:</strong> Praktikantin (Softwareentwicklung) bei ArianeGroup · <strong>Ich suche:</strong> ein Praktikum als Product Managerin, Beginn zwischen März und Juni 2027.',

    'timeline.h2': "Werdegang",
    'timeline.academics': "Ausbildung",
    'timeline.professional': "Berufserfahrung",
    'timeline.msc': "Masterstudium Ingenieurwissenschaften, <a href=\"https://www.telecom-paris.fr\" target=\"_blank\" rel=\"noopener\">Télécom Paris</a> (<a href=\"https://www.ip-paris.fr\" target=\"_blank\" rel=\"noopener\">IP Paris</a>). <small>Eine der renommiertesten französischen Ingenieurhochschulen (Grande École, Zulassung über ein selektives Auswahlverfahren).</small><br><br>Schwerpunkte: Data Science &amp; KI + 3D-Grafik &amp; Interaktion (HCI)",
    'timeline.arianegroup.company': "ArianeGroup",
    'timeline.arianegroup.role': "Praktikantin Softwareentwicklung",
    'timeline.dataannotation.company': "DataAnnotation",
    'timeline.dataannotation.role': "KI-Bewerterin (Teilzeit)",
    'timeline.ey.company': "EY",
    'timeline.ey.role': "Praktikantin Strategie- &amp; Technologieberatung",
    'timeline.joc.company': "Japanisches Olympisches Komitee",
    'timeline.joc.role': "Assistentin des Präsidenten",

    'how.h2': "Meine Arbeitsweise",
    'how.b1.title': "Launchen oder nicht launchen",
    'how.b1.detail': `
            <small>Comète (Audiovisueller Studierendenclub der Télécom Paris) - Generalsekretärin</small>
            Unser Audiovisual-Club Comète veröffentlicht jährlich über 50.000 Eventfotos auf einer für alle Studierenden offenen Website. Sich selbst auf diesen Fotos wiederzufinden, kann dabei schnell mühsam werden. Also habe ich eine Gesichtserkennungs-Funktion prototypisiert, mit der sich jede*r in den Archiven wiederfinden kann. Das Tool funktionierte - aber nachdem ich mich mit den Fragen rund um biometrische Daten beschäftigt hatte, habe ich mich entschieden, es nicht zu launchen. Die schwierigste Produktentscheidung, die ich bisher getroffen habe, war also nicht etwas, das ich gebaut habe: Es war das, was ich bewusst nicht veröffentlicht habe.
          `,
    'how.b2.title': "Echte Entscheidungen, live, über mehrere Sprachen hinweg",
    'how.b2.detail': `
            <small>Olympische Spiele Paris 2024</small>
            Als Assistentin des Präsidenten des Japanischen Olympischen Komitees während der Spiele in Paris 2024 habe ich die japanische Delegation mit den lokalen Organisatoren koordiniert - bei ständig wechselnden Zeitplänen und widersprüchlichen Interessen. Alles musste live entschieden werden, in 3 Sprachen (JP/FR/EN). Am Ende war die Sprachbarriere nie das Schwierige: Die eigentliche Herausforderung war, schnell zu entscheiden, während alle zusahen.
          `,
    'how.b3.title': "Das Problem dort finden, wo es wirklich liegt",
    'how.b3.detail': `
            <small>EY - Strategie- &amp; Technologieberatung</small>
            Während meines Praktikums bei EY habe ich 12 Interviews in 4 Unternehmensbereichen geführt, um zu verstehen, wie Teams KI wirklich einsetzen, und daraus Empfehlungen für Führungskräfte abgeleitet. Das Nützlichste kam nie aus dem Briefing - sondern daraus, zu beobachten, wie Menschen tatsächlich arbeiten. Denselben Instinkt hatte ich bei meinen eigenen Projekten: Ein Architektur-Doktorand erzählte mir, dass die Steuerung per Controller beim Entwerfen zu langsam zum Iterieren sei - also habe ich mit zwei Freunden ein VR-Tool gebaut, das hauptsächlich per Sprache gesteuert wird. Dabei habe ich gelernt, wie wichtig es ist, mit Menschen vor Ort zu sprechen, statt zu raten.
          `,
    'how.b4.title': "Rahmenbedingungen als eigentliche Aufgabe, nicht als Hindernis",
    'how.b4.detail': `
            <small>Bureau des Élèves (Studierendenrat) der Télécom Paris</small>
            Mit meinem Team war ich für Budget und Logistik einer 20.000-€-Reise für 90 Personen verantwortlich. Festes Budget, feste Termine - und mehr Wünsche, als das Budget hergab: Die eigentliche Arbeit bestand also darin, zu entscheiden, was am wichtigsten war, und den Rest sauber zu streichen. Rahmenbedingungen sind nicht der lästige Teil eines Projekts; oft sind sie es, die zur eigentlichen Entscheidung zwingen.
          `,

    'portfolio.h2': "Portfolio",
    'portfolio.readMore': "mehr lesen ↓",
    'portfolio.lightboxClose': "Bild schließen",
    'portfolio.expandVideo': "Video vergrößern",
    'portfolio.showLess': "weniger anzeigen ↑",
    'portfolio.nextProject': "nächstes:",

    'portfolio.p1.title': "Recette - Soziales Netzwerk für Fotobearbeitung",
    'portfolio.p1.small': "React Native, Expo, Skia Shaders - Alleine entwickelt, geschlossene Beta",
    'portfolio.p1.summary': "Was, wenn man die Bearbeitungseinstellungen teilt - nicht nur das Foto?",
    'portfolio.p1.intro1': "Ich bearbeite Fotos als Hobby und stoße dabei immer wieder auf dasselbe Problem: Man kann einen Look stundenlang bewundern, ohne ihn je nachbilden zu können. Das „Wie“ bleibt in der App verschlossen - oder im Kopf der Person, die ihn erschaffen hat.",
    'portfolio.p1.intro2': "Deshalb habe ich Recette entwickelt, ein soziales Netzwerk für Fotobearbeitung mit einer zentralen Wette: die Bearbeitung als kopierbares Rezept zu behandeln, nicht als verstecktes Nebenprodukt. Man entdeckt im Feed einen Look, der einem gefällt, und wendet ihn auf das eigene Foto an. Das Produkt existiert, um die Lücke zwischen „ich wünschte, meins sähe so aus“ und dem tatsächlichen Erreichen zu verkleinern.",
    'portfolio.p1.more1': "Diese Entscheidung - das Rezept als eigenständiges Objekt zu behandeln - hat mein gesamtes Produkt geprägt. Feed, Profil, Editor: Alles musste die Bearbeitungen lesbar und remixbar machen, nicht nur fertige Bilder zeigen. Genau das macht aus einem einfachen Bearbeitungstool eine soziale Schleife.",
    'portfolio.p1.more2': "Ich habe mich von VSCOs System gesperrter Ebenen inspirieren lassen, damit Rezepte strukturiert und reproduzierbar bleiben. Die Intensität des gewählten Filters lässt sich anpassen. Außerdem lasse ich die Bearbeitung direkt auf dem Gerät (Computer/Handy) mit Skia-Shadern laufen, damit jede Anpassung sofort sichtbar ist - eine soziale Schleife stirbt schnell, sobald sie sich wie Warten anfühlt.",
    'portfolio.p1.more3': "Die App befindet sich derzeit in einer geschlossenen Beta: Ich teste vor allem die Nutzerbindung und suche nach Wegen, sie durch Gamification zu verbessern.",
    'portfolio.p1.videoCaption': "Looks im Feed durchstöbern und ein Rezept auf ein neues Foto remixen",

    'portfolio.p2.title': "Plattform zur Sentiment-Analyse von Bewertungen - Interaktive Karte",
    'portfolio.p2.small': "Python, Leaflet, Selenium, RoBERTa - Gruppenprojekt mit dem Sozialwissenschafts-Team der Hochschule",
    'portfolio.p2.summary': "Wie sieht man, wie sich ein Ruf nach einem Ereignis verändert?",
    'portfolio.p2.intro1': "Das Sozialwissenschafts-Team der Hochschule kam mit einer offenen Forschungsfrage zu uns: Wie verändert ein Ereignis den Ruf eines Ortes im Laufe der Zeit? Schwer zu untersuchen: Ein Ruf ist unscharf, verstreut über Tausende Bewertungen, und er verändert sich ständig. Sie mussten ihn sehen können, nicht nur beschreiben.",
    'portfolio.p2.intro2': "Also haben wir eine interaktive Karte gebaut, die verstreute öffentliche Bewertungen in ein lesbares Signal verwandelt. Wir haben Google-Bewertungen gescrapt, eine Sentiment-Analyse mit einem RoBERTa-Modell laufen lassen, um Freitext in ein auswertbares Signal zu verwandeln, und alles auf einer Leaflet-Karte dargestellt - so werden ein Ereignis und seine Folgen als Muster im Zeitverlauf lesbar. Ich habe UI/UX übernommen.",
    'portfolio.p2.videoCaption': "Bildunterschrift hier einfügen",
    'portfolio.p2.more1': "Das eigentliche Designproblem war die Lesbarkeit: Zeit, Geografie und Sentiment sind drei Dimensionen auf einmal. Und die Entwicklung über die Zeit zu sehen, war genau das, was für die Forschung am wichtigsten war. Die entscheidende Design-Entscheidung war deshalb, für genau die eine Sache zu gestalten, die die Forschenden wirklich wahrnehmen mussten: wie sich ein Ort im Laufe der Zeit verändert.",
    'portfolio.p2.mediaConceptCaption': "Bildunterschrift hier einfügen",
    'portfolio.p2.mediaRealCaption': "Bildunterschrift hier einfügen",
    'portfolio.p2.more2': "Genau diese Zurückhaltung hat daraus ein Forschungsinstrument gemacht statt einer Datenhalde. Das Interessanteste war weder das Scraping noch das Modell: Es war, von einer vagen menschlichen Frage auszugehen und daraus ein Werkzeug zu machen, das die Antwort sichtbar macht.",

    'portfolio.p3.title': "Sprachgesteuertes VR-Architekturstudio",
    'portfolio.p3.small': "Unity, Meta Quest, Gemini API - Gruppenprojekt",
    'portfolio.p3.summary': "Ein Gebäude zu entwerfen sollte nicht damit beginnen, erst Gamer werden zu müssen.",
    'portfolio.p3.intro1': "Alles begann mit einem Gespräch mit einer Architektur-Doktorandin, die beschrieb, wie langsam es ist, an einem 3D-Gebäudeentwurf zu prototypisieren und zu iterieren. Der Engpass waren nicht die Ideen: Es war die Reibung, sie schnell in eine nutzbare Form zu bringen.",
    'portfolio.p3.intro2': "Also haben wir ein VR-Studio gebaut, in dem Architekt*innen ihre Prototypen im Raum formen - mit einer zentralen Entscheidung: Controller durch Sprache zu ersetzen. Jemandem, der nicht spielt, zwei Quest-Controller in die Hand zu drücken und flüssige 3D-Manipulation zu erwarten, ist schon viel verlangt; die Bedienung wird selbst zum Hindernis. Sprache umgeht das: Man beschreibt, was man will, und die Oberfläche verschwindet fast vollständig. So passt sich das Tool seinen echten Nutzer*innen an, statt von ihnen zu verlangen, Gamer zu werden. Ich habe mich auf das Interaktionsdesign konzentriert.",
    'portfolio.p3.media1Caption': "Design-Phase: Ich habe eine von Gemini erstellte Stichwort-Zusammenfassung hinzugefügt, damit Nutzer*innen sehen, was das System aus ihren Eingaben <i>verstanden</i> hat.",
    'portfolio.p3.media2Caption': "Generierungs-Phase: Die Oberfläche, nachdem das System aus der an Gemini gesendeten Sprache die beiden Prototyp-Optionen erzeugt hat.",
    'portfolio.p3.more1': "Genau diese Entscheidung brachte die interessantesten Probleme mit sich. Sprache bedeutete, sich auf die Gemini API zu verlassen, um lockere natürliche Sprache in strukturierte Aktionen zu übersetzen - eine ganz andere Design-Herausforderung, als einen Button mit einer Funktion zu verknüpfen. Man gestaltet für Mehrdeutigkeit und Absicht, nicht für präzise Eingaben; ein großer Teil der Arbeit bestand also darin, das System tolerant dafür zu machen, wie Menschen Dinge wirklich formulieren.",
    'portfolio.p3.more2': "Und diese Formulierungen haben wir nur durchs Beobachten gefunden. Wir haben 7 Design-Iterationen mit 9 Nutzer*innen durchgeführt, bevor es an das Headset ging - auf diese Anzahl an Iterationen bin ich am stolzesten, denn das eigentliche Lernen kam davon, zuzusehen, wie jemand an einem Befehl scheitert, den wir für offensichtlich hielten, und ihn dann zu überarbeiten. Der „offensichtliche“ Befehl war es selten so sehr, wie wir dachten.",

    'portfolio.p4.title': "Bildverarbeitung und Mechatronik für Menschen mit Sehbehinderung",
    'portfolio.p4.small': "Python, OpenCV, YOLOv9, Arduino - Top 3% beim TIPE (landesweiter Wettbewerb), Note 20/20",
    'portfolio.p4.summary': "Kann ein blinder Zuschauer ein Fußballspiel in Echtzeit verfolgen?",
    'portfolio.p4.intro1': "2024 stand der TIPE-Wettbewerb unter dem Thema Sport. Statt wie die meisten um mich herum auf Leistungsanalyse zu setzen, habe ich mir eine andere Frage gestellt: Wer kann ein Spiel heute nicht genießen? Sehbehinderte Zuschauer*innen hören die Stimmung im Stadion, verlieren aber den Faden, wo sich der Ball wirklich befindet.",
    'portfolio.p4.intro2': "Also habe ich ein Tracking-System gebaut, das den Ball erkennt und seine Position über das Tastgefühl statt über das Sehen vermittelt: KI-basierte Ballerkennung und Felderkennung, übersetzt in etwas, das man fühlt statt sieht.",
    'portfolio.p4.mediaCoverCaption': "Die Kernidee des Projekts",
    'portfolio.p4.more1a': "Die Entscheidung, die alles geprägt hat, war, Echtzeit über Präzision zu stellen. Ein Spiel wartet nicht: Ein präzises, aber verspätetes System nützt nichts, denn man würde eine bereits vergangene Aktion spüren. Also habe ich Latenz zur wichtigsten Einschränkung gemacht und im Gegenzug eine vertretbare Fehlermarge akzeptiert: 180 ms Inferenzzeit, ~6 m Lokalisierungsgenauigkeit.",
    'portfolio.p4.mediaAlgorithmCaption': "Vollständiger Algorithmus",
    'portfolio.p4.more1b': "Diese 6 Meter sind ein bewusster Kompromiss: präzise genug, um etwas zu vermitteln, aber schnell genug, um wirklich live zu wirken.",
    'portfolio.p4.mediaHardwareCaption': "Die tatsächliche Hardware - der sensorische Teil für die Nutzer*innen misst nur 12 cm.",
    'portfolio.p4.more1c': "Dieselbe Überlegung hat auch die Hardware geprägt: Ich habe 60 Kamerapositionen getestet, um die beste Balance zwischen Abdeckung und Genauigkeit zu finden - eine Abwägung, die man nur durch systematisches Testen findet, nicht durch Raten.",
    'portfolio.p4.mediaDetectionCaption': "Ballerkennung.",
    'portfolio.p4.mediaPositionsCaption': "Lokalisierungsfehler über die getesteten Azimut-/Elevations-Kamerapositionen - minimaler Fehler 0,035 m.",
    'portfolio.p4.more2': "An all die verschiedenen Menschen rund um den Sport zu denken - Spieler*innen, Zuschauer*innen - hat mich zu diesem Projekt geführt. Und von „Wer wird ausgeschlossen?“ statt von „Was ist technisch beeindruckend?“ auszugehen, ist bis heute meine Art, Probleme auszuwählen.",

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
      ? ((dict && dict['portfolio.showLess']) || 'show less ↑')
      : ((dict && dict['portfolio.readMore']) || 'read more ↓');
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
