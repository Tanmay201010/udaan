/* ═══════════════════════════════════════════════════════════════
   UdaanPro · UI Enhance Layer
   - Three.js floating particle / coin field
   - Cursor follower
   - Tilt re-init on route changes
   - Counter animations
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─────── Cursor follower ───────
  const cursor = document.querySelector('.cursor-glow');
  if (cursor && window.matchMedia('(hover: hover)').matches) {
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    let cx = tx, cy = ty;
    window.addEventListener('mousemove', (e) => {
      tx = e.clientX; ty = e.clientY;
    });
    function animateCursor() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      requestAnimationFrame(animateCursor);
    }
    animateCursor();
  } else if (cursor) {
    cursor.style.display = 'none';
  }

  // ─────── Three.js animated currency particle field ───────
  function initThree() {
    if (typeof THREE === 'undefined') return;
    const canvas = document.getElementById('three-canvas');
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 18;

    // — Star particles —
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const palette = [
      [0.965, 0.776, 0.455], // gold
      [0.369, 0.918, 0.831], // cyan
      [0.718, 0.580, 1.000], // violet
      [1.0, 1.0, 1.0]        // white
    ];
    for (let i = 0; i < starCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3 + 0] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // — Floating glowing coins (torus geometry) —
    const coinGroup = new THREE.Group();
    const coinGeo = new THREE.TorusGeometry(0.9, 0.32, 16, 64);
    const coinMat = new THREE.MeshBasicMaterial({
      color: 0xf6c674,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    const coinMat2 = new THREE.MeshBasicMaterial({
      color: 0x5eead4,
      wireframe: true,
      transparent: true,
      opacity: 0.35
    });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(coinGeo, i % 2 === 0 ? coinMat : coinMat2);
      c.position.set(
        (Math.random() - 0.5) * 24,
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 14 - 4
      );
      c.scale.setScalar(0.6 + Math.random() * 1.2);
      c.userData = {
        rotSpeed: 0.002 + Math.random() * 0.006,
        floatSpeed: 0.3 + Math.random() * 0.4,
        offset: Math.random() * Math.PI * 2
      };
      coinGroup.add(c);
    }
    scene.add(coinGroup);

    // — Octahedron crystals —
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    const crystalMat = new THREE.MeshBasicMaterial({
      color: 0xb794ff, wireframe: true, transparent: true, opacity: 0.25
    });
    const crystalGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(crystalGeo, crystalMat);
      c.position.set(
        (Math.random() - 0.5) * 26,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12 - 2
      );
      c.scale.setScalar(0.8 + Math.random() * 1.4);
      c.userData = { rotSpeed: 0.001 + Math.random() * 0.004, offset: Math.random() * Math.PI * 2 };
      crystalGroup.add(c);
    }
    scene.add(crystalGroup);

    // — Mouse parallax —
    let mouseX = 0, mouseY = 0;
    window.addEventListener('mousemove', (e) => {
      mouseX = (e.clientX / window.innerWidth - 0.5);
      mouseY = (e.clientY / window.innerHeight - 0.5);
    });

    // — Resize —
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // — Animate —
    const clock = new THREE.Clock();
    function animate() {
      const t = clock.getElapsedTime();

      stars.rotation.y = t * 0.02;
      stars.rotation.x = t * 0.01;

      coinGroup.children.forEach((c) => {
        c.rotation.x += c.userData.rotSpeed;
        c.rotation.y += c.userData.rotSpeed * 1.4;
        c.position.y += Math.sin(t * c.userData.floatSpeed + c.userData.offset) * 0.005;
      });

      crystalGroup.children.forEach((c) => {
        c.rotation.x += c.userData.rotSpeed;
        c.rotation.z += c.userData.rotSpeed * 0.8;
      });

      // parallax camera sway
      camera.position.x += (mouseX * 1.5 - camera.position.x) * 0.04;
      camera.position.y += (-mouseY * 1.2 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ─────── Tilt re-init on route changes ───────
  function reinitTilt() {
    if (typeof VanillaTilt === 'undefined') return;
    const els = document.querySelectorAll('[data-tilt]:not(.tilt-init)');
    els.forEach((el) => {
      VanillaTilt.init(el, {
        max: parseFloat(el.dataset.tiltMax) || 10,
        speed: 600,
        glare: el.hasAttribute('data-tilt-glare'),
        'max-glare': parseFloat(el.dataset.tiltMaxGlare) || 0.2,
        perspective: 1200,
        scale: 1.01
      });
      el.classList.add('tilt-init');
    });
  }

  // ─────── Animated counters ───────
  function animateCounter(el) {
    if (!el) return;
    const raw = el.textContent.trim();
    const isMoney = raw.includes('₹');
    const nMatch = raw.replace(/[^0-9.-]/g, '');
    const target = parseFloat(nMatch);
    if (isNaN(target) || target === 0) return;
    const dur = 900;
    const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      el.textContent = (isMoney ? '₹ ' : '') + val.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: isMoney ? 2 : 0 });
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Watch view container for changes
  const viewContainer = () => document.getElementById('view-container');

  function onViewChange() {
    setTimeout(() => {
      reinitTilt();
      // animate dashboard counters
      document.querySelectorAll('#dash-cash-balance, #dash-expenses, #dash-bills-count, #dash-journal-count').forEach(animateCounter);
      // ensure icons re-render
      if (window.lucide) lucide.createIcons();
    }, 80);
  }

  function setupMutationObserver() {
    const vc = viewContainer();
    if (!vc) { setTimeout(setupMutationObserver, 200); return; }
    const obs = new MutationObserver(onViewChange);
    obs.observe(vc, { childList: true, subtree: false });
    onViewChange();
  }

  // ─────── Init ───────
  function init() {
    initThree();
    reinitTilt();
    setupMutationObserver();

    // re-init tilt when login dismissed
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) {
      const o = new MutationObserver(() => {
        if (loginOverlay.style.display === 'none') {
          setTimeout(reinitTilt, 100);
        }
      });
      o.observe(loginOverlay, { attributes: true, attributeFilter: ['style'] });
    }

    // Login enter on keydown
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && loginOverlay && loginOverlay.style.display !== 'none') {
        const btn = document.getElementById('login-btn');
        if (btn) btn.click();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
