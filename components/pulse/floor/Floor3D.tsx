"use client";

/**
 * The three.js shop floor. THIS IS THE ONLY FILE THAT TOUCHES three, and it does so with a dynamic
 * `import("three")` inside an effect, so the library lives in its own chunk and never enters the
 * pulse's initial bundle (tests/pulse-floor-bundle.test.ts pins both facts). FloorCard loads this
 * component itself through next/dynamic with ssr:false, only when the device qualifies.
 *
 * Stylized, not a replica: one box per station on a soft ground, the status colour as the box's
 * emissive tint (green covered · amber short / closing soon · red uncovered · grey closed), a
 * sprite label with the station name and the first names on it. Tap a box to select it; in arrange
 * mode (GM+) drag it across the ground plane and the parent saves the snapped grid position.
 */
import { useEffect, useRef } from "react";
import { FLOOR_MAX_COORD } from "@/lib/pulse/floor-shared";
import type { FloorLayout, FloorStation } from "@/lib/pulse/types";
import { STATUS_FILL } from "@/components/pulse/shared";

type Three = typeof import("three");

export default function Floor3D({ stations, layout, selectedId, onSelect, arranging, onMove, statusLabel }: {
  stations: FloorStation[];
  layout: FloorLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  arranging: boolean;
  onMove: (id: string, x: number, y: number) => void;
  statusLabel: (s: FloorStation) => string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ THREE: Three; scene: import("three").Scene; camera: import("three").PerspectiveCamera; renderer: import("three").WebGLRenderer; boxes: Map<string, import("three").Mesh>; labels: Map<string, import("three").Sprite>; raycaster: import("three").Raycaster; dispose: () => void } | null>(null);
  const propsRef = useRef({ stations, layout, selectedId, onSelect, arranging, onMove, statusLabel });
  propsRef.current = { stations, layout, selectedId, onSelect, arranging, onMove, statusLabel };

  // Mount once: load three, build the renderer, run the loop, clean up fully on unmount.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    (async () => {
      const THREE = await import("three");
      const el = host.current;
      if (cancelled || !el) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(el.clientWidth, Math.max(240, el.clientHeight));
      el.appendChild(renderer.domElement);
      renderer.domElement.style.touchAction = "none";
      renderer.domElement.setAttribute("aria-hidden", "true");
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(240, el.clientHeight), 0.1, 100);
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 0.8);
      sun.position.set(4, 8, 6);
      scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_MAX_COORD + 2, FLOOR_MAX_COORD + 2), new THREE.MeshStandardMaterial({ color: 0xfffdf5, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(FLOOR_MAX_COORD / 2, -0.01, FLOOR_MAX_COORD / 2);
      ground.name = "ground";
      scene.add(ground);
      const boxes = new Map<string, import("three").Mesh>();
      const labels = new Map<string, import("three").Sprite>();
      const raycaster = new THREE.Raycaster();
      const dispose = () => {
        for (const b of boxes.values()) { b.geometry.dispose(); (b.material as import("three").Material).dispose(); }
        for (const l of labels.values()) { l.material.map?.dispose(); l.material.dispose(); }
        ground.geometry.dispose(); (ground.material as import("three").Material).dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      sceneRef.current = { THREE, scene, camera, renderer, boxes, labels, raycaster, dispose };

      const observer = new ResizeObserver(() => {
        const w = el.clientWidth; const h = Math.max(240, el.clientHeight);
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      observer.observe(el);

      // Pointer: tap selects, drag (arrange mode) moves along the ground plane.
      let dragging: string | null = null;
      const pointer = new THREE.Vector2();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      const toPointer = (e: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
      };
      const pick = (): string | null => {
        const hits = raycaster.intersectObjects([...boxes.values()], false);
        return hits[0] ? (hits[0].object.userData.id as string) : null;
      };
      const onDown = (e: PointerEvent) => {
        toPointer(e);
        const id = pick();
        if (propsRef.current.arranging && id) { dragging = id; renderer.domElement.setPointerCapture(e.pointerId); return; }
        propsRef.current.onSelect(id === propsRef.current.selectedId ? null : id);
      };
      const onMovePtr = (e: PointerEvent) => {
        if (!dragging) return;
        toPointer(e);
        if (!raycaster.ray.intersectPlane(plane, hit)) return;
        const box = boxes.get(dragging);
        if (box) { box.position.x = Math.max(0, Math.min(FLOOR_MAX_COORD, hit.x)); box.position.z = Math.max(0, Math.min(FLOOR_MAX_COORD, hit.z)); labels.get(dragging)?.position.set(box.position.x, 1.35, box.position.z); }
      };
      const onUp = () => {
        if (!dragging) return;
        const box = boxes.get(dragging);
        if (box) propsRef.current.onMove(dragging, Math.round(box.position.x * 2) / 2, Math.round(box.position.z * 2) / 2);
        dragging = null;
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointermove", onMovePtr);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointercancel", onUp);

      const loop = (time: number) => {
        // Uncovered stations breathe (the device already passed the reduced-motion check).
        for (const b of boxes.values()) {
          const m = b.material as import("three").MeshStandardMaterial;
          if (b.userData.status === "uncovered") m.emissiveIntensity = 0.45 + 0.25 * Math.sin(time / 350);
        }
        renderer.render(scene, camera);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      sync();
      sceneRef.current.dispose = () => { observer.disconnect(); cancelAnimationFrame(frame); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointermove", onMovePtr); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("pointercancel", onUp); dispose(); };
    })().catch((err) => console.error("pulse floor 3d failed", err));
    return () => { cancelled = true; sceneRef.current?.dispose(); sceneRef.current = null; };
  }, []);

  /** Rebuild boxes/labels from the current props (cheap: a handful of stations). */
  function sync() {
    const s = sceneRef.current;
    if (!s) return;
    const { THREE, scene, boxes, labels, camera } = s;
    const { stations, layout, selectedId, statusLabel } = propsRef.current;
    const keep = new Set(stations.map((st) => st.id));
    for (const [id, box] of boxes) if (!keep.has(id)) { scene.remove(box); box.geometry.dispose(); (box.material as import("three").Material).dispose(); boxes.delete(id); const l = labels.get(id); if (l) { scene.remove(l); l.material.map?.dispose(); l.material.dispose(); labels.delete(id); } }
    for (const st of stations) {
      const p = layout[st.id] ?? { x: 0, y: 0 };
      let box = boxes.get(st.id);
      if (!box) {
        box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
        box.userData.id = st.id;
        scene.add(box);
        boxes.set(st.id, box);
      }
      const mat = box.material as import("three").MeshStandardMaterial;
      mat.color.set(STATUS_FILL[st.status]);
      mat.emissive.set(STATUS_FILL[st.status]);
      mat.emissiveIntensity = st.status === "closed" || st.status === "inactive" ? 0.05 : 0.35;
      mat.opacity = st.status === "closed" ? 0.55 : 1; mat.transparent = st.status === "closed";
      box.userData.status = st.status;
      box.position.set(p.x, 0.25, p.y);
      box.scale.setScalar(st.id === selectedId ? 1.15 : 1);
      // Label sprite (canvas texture): name + who is on it + the status word.
      const text = `${st.name}\n${st.people.join(" · ") || (st.filled > 0 ? "•".repeat(Math.min(3, st.filled)) : "")}\n${statusLabel(st).toUpperCase()}`;
      let label = labels.get(st.id);
      if (!label || label.userData.text !== text) {
        if (label) { scene.remove(label); label.material.map?.dispose(); label.material.dispose(); }
        const canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 128;
        const g = canvas.getContext("2d");
        if (g) {
          g.fillStyle = "rgba(255,255,255,0.92)"; g.fillRect(0, 0, 256, 128);
          g.fillStyle = "#1F1A0E"; g.textAlign = "center";
          const lines = text.split("\n");
          g.font = "bold 28px sans-serif"; g.fillText(lines[0] ?? "", 128, 42, 240);
          g.font = "22px sans-serif"; g.fillStyle = "#5A5240"; g.fillText(lines[1] ?? "", 128, 76, 240);
          g.font = "bold 18px sans-serif"; g.fillStyle = "#7A7260"; g.fillText(lines[2] ?? "", 128, 108, 240);
        }
        const tex = new THREE.CanvasTexture(canvas);
        label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        label.scale.set(1.6, 0.8, 1);
        label.userData.text = text;
        scene.add(label);
        labels.set(st.id, label);
      }
      label.position.set(p.x, 1.35, p.y);
    }
    // Frame the camera on the occupied area.
    const xs = stations.map((st) => layout[st.id]?.x ?? 0); const zs = stations.map((st) => layout[st.id]?.y ?? 0);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 1; const cz = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 1;
    const span = Math.max(2, xs.length ? Math.max(...xs) - Math.min(...xs) : 2, zs.length ? Math.max(...zs) - Math.min(...zs) : 2);
    camera.position.set(cx + span * 0.9, span * 1.1 + 2.5, cz + span * 1.3);
    camera.lookAt(cx, 0, cz);
  }

  useEffect(() => { sync(); }, [stations, layout, selectedId, arranging, statusLabel]);

  return <div ref={host} className="h-[300px] w-full min-w-0 overflow-hidden rounded-lg bg-co-surface-inset sm:h-[340px]" />;
}
