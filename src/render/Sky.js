// Sky.js — gradient sky dome, drifting puffy clouds, and the stylized lagoon water

import * as THREE from 'three';
import { toonMat, noOutline } from './Toon.js';

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.clouds = [];

    const skyGeo = new THREE.SphereGeometry(180, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d9dff) },
        mid: { value: new THREE.Color(0x8fd3ff) },
        bottom: { value: new THREE.Color(0xfff1d6) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        varying vec3 vPos;
        void main() {
          float h = vPos.y;
          vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(bottom, mid, smoothstep(-0.05, 0.12, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.uniforms = skyMat.uniforms;
    // Sudden-death dusk: the dome (and scene fog) blend toward a toy-sunset purple/orange
    this.base = { top: new THREE.Color(0x3d9dff), mid: new THREE.Color(0x8fd3ff), bottom: new THREE.Color(0xfff1d6), fog: new THREE.Color(0xbfe6ff) };
    this.dusk = { top: new THREE.Color(0x5a2d8c), mid: new THREE.Color(0xff7a8a), bottom: new THREE.Color(0xffc46b), fog: new THREE.Color(0xf0a8b8) };
    this.tint = 0;
    this.tintTarget = 0;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    noOutline(sky);
    scene.add(sky);

    const cloudMat = toonMat({ color: 0xffffff, emissive: 0x9ab0c8, emissiveIntensity: 0.35 });
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const r = 2.2 + Math.random() * 2.2;
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
        puff.position.set(p * 3 - puffs * 1.5 + Math.random(), Math.random() * 1.2, Math.random() * 2 - 1);
        puff.scale.y = 0.7;
        cloud.add(puff);
      }
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 70 + Math.random() * 40;
      cloud.position.set(Math.cos(angle) * dist, 28 + Math.random() * 18, Math.sin(angle) * dist);
      cloud.userData = { angle, dist, speed: 0.004 + Math.random() * 0.006 };
      noOutline(cloud);
      scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  /** 0 = sunny, 1 = full sudden-death dusk (eased in update) */
  setTint(k) {
    this.tintTarget = k;
  }

  update(dt) {
    if (Math.abs(this.tint - this.tintTarget) > 0.001) {
      this.tint += (this.tintTarget - this.tint) * Math.min(1, dt * 1.5);
      for (const k of ['top', 'mid', 'bottom']) this.uniforms[k].value.copy(this.base[k]).lerp(this.dusk[k], this.tint);
      this.scene.fog?.color.copy(this.base.fog).lerp(this.dusk.fog, this.tint);
    }
    for (const c of this.clouds) {
      c.userData.angle += c.userData.speed * dt;
      c.position.x = Math.cos(c.userData.angle) * c.userData.dist;
      c.position.z = Math.sin(c.userData.angle) * c.userData.dist;
      c.lookAt(0, c.position.y, 0);
    }
  }
}

export class Water {
  constructor(scene, level = -5) {
    this.level = level;
    this.uniforms = {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x14b8d8) },
      shallow: { value: new THREE.Color(0x6ff0ee) },
      foam: { value: new THREE.Color(0xffffff) },
    };
    const geo = new THREE.PlaneGeometry(260, 260, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float time;
        varying vec3 vWorld;
        varying float vWave;
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.35 + time * 1.3) * 0.18 + cos(p.z * 0.3 + time * 1.1) * 0.18;
          p.y += w;
          vWave = w;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam;
        varying vec3 vWorld;
        varying float vWave;
        void main() {
          float r = length(vWorld.xz);
          vec3 c = mix(shallow, deep, smoothstep(14.0, 40.0, r));
          float ring = sin(r * 1.4 - time * 2.2) * 0.5 + 0.5;
          float nearFoam = 1.0 - smoothstep(9.0, 13.5, r);
          float bands = step(0.93, ring) * smoothstep(40.0, 16.0, r);
          float crest = step(0.28, vWave);
          c = mix(c, foam, max(max(bands * 0.55, crest * 0.35), nearFoam * 0.8));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = level;
    noOutline(this.mesh);
    scene.add(this.mesh);
  }

  update(dt) {
    this.uniforms.time.value += dt;
  }
}
