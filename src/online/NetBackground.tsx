import { useEffect, useRef } from 'react';

// 메인 화면 배경 (예진님 배경 시안 v6 기준): 짙은 남색 바탕 + 가운데 옅은 회로 선 +
// 오른쪽에 꼬이며 흐르는 빛 선 다발 + 천천히 떠다니는 빛 점.
// '움직임 줄이기' 설정이면 멈춘 한 장면만 그린다.
const DOT_COLORS = ['95,212,255', '138,123,255', '224,139,255', '60,255,216'];
const LINK = 120;
const RIBBON = 72;

type Dot = { x: number; y: number; vx: number; vy: number; r: number; c: string };

// 하늘색 → 보라 → 분홍
function ribbonColor(k: number): string {
  const stops = [
    [60, 220, 255],
    [150, 100, 255],
    [255, 80, 210],
  ];
  const p = k * 2;
  const i = Math.min(1, Math.floor(p));
  const f = p - i;
  const c = stops[i].map((v, n) => Math.round(v + (stops[i + 1][n] - v) * f));
  return `${c[0]},${c[1]},${c[2]}`;
}

export function NetBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    let circuit: HTMLCanvasElement | null = null;
    let raf = 0;
    let t = 0;
    const pointer = { x: -9999, y: -9999 };
    // 가닥마다 따로 흔들리는 속도·방향·시작점을 무작위로 준다. 흔들림 폭은 작게 해서 다발 모양은 유지한다
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const sign = () => (Math.random() < 0.5 ? -1 : 1);
    const lines = Array.from({ length: RIBBON }, (_, k) => ({
      phase: (k / RIBBON) * Math.PI * 1.15,
      amp: 0.75 + 0.5 * Math.sin(k * 1.7),
      color: ribbonColor(k / (RIBBON - 1)),
      js: [rnd(0.4, 1.3) * sign(), rnd(0.3, 1.1) * sign(), rnd(0.3, 0.9), rnd(0.4, 1.2)],
      jo: Array.from({ length: 4 }, () => rnd(0, Math.PI * 2)),
    }));
    // 선 다발 모양은 그대로 두고, 흐르는 방향만 불규칙하게: 주기가 서로 안 맞는 사인을 겹쳐
    // 위·아래로 갔다가 멈칫했다가 바뀌는 위상을 만든다 (한쪽으로 계속 늘지 않음)
    const o = Array.from({ length: 6 }, () => Math.random() * Math.PI * 2);
    const wander = (s: number, a: number, b: number, c: number) => 2.4 * Math.sin(s * 0.31 + a) + 1.5 * Math.sin(s * 0.53 + b) + 0.9 * Math.sin(s * 0.89 + c);

    // 회로 선: 크기가 바뀔 때만 한 번 그려 두고 매 장면에 붙인다
    const drawCircuit = (dpr: number) => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d');
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.lineWidth = 1;
      for (let i = 0; i < 34; i++) {
        const x0 = w * (0.38 + Math.random() * 0.42);
        const y0 = h * (0.12 + Math.random() * 0.72);
        const dir = Math.random() < 0.5 ? -1 : 1;
        const l1 = 30 + Math.random() * 90;
        const l2 = 15 + Math.random() * 45;
        const l3 = 30 + Math.random() * 110;
        const pts: [number, number][] = [
          [x0, y0],
          [x0 + l1, y0],
          [x0 + l1 + l2, y0 + dir * l2],
          [x0 + l1 + l2 + l3, y0 + dir * l2],
        ];
        g.strokeStyle = 'rgba(90,130,210,0.2)';
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
        g.stroke();
        for (const [x, y] of [pts[0], pts[3]]) {
          g.fillStyle = 'rgba(120,200,255,0.55)';
          g.beginPath();
          g.arc(x, y, 1.8, 0, Math.PI * 2);
          g.fill();
        }
      }
      return c;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      circuit = drawCircuit(dpr);
      const n = Math.min(110, Math.round((w * h) / 14000));
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 0.7 + Math.random() * 1.6,
        c: DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)],
      }));
      if (still) draw();
    };

    const drawRibbon = () => {
      const narrow = w < 760;
      const cx = w * (narrow ? 0.9 : 0.84);
      const base = w * (narrow ? 0.16 : 0.11);
      ctx.lineWidth = 1;
      const P = wander(t, o[0], o[1], o[2]);
      const Q = wander(t * 0.9, o[3], o[4], o[5]);
      for (const l of lines) {
        ctx.strokeStyle = `rgba(${l.color},${narrow ? 0.175 : 0.35})`;
        const [s1, s2, s3, s4] = l.js;
        const [o1, o2, o3, o4] = l.jo;
        const p1 = P + l.phase + 0.4 * Math.sin(t * s1 + o1);
        const p2 = Q + l.phase * 0.5 + 0.5 * Math.sin(t * s2 + o2);
        const amp = l.amp * (1 + 0.1 * Math.sin(t * s3 + o3));
        const dx = base * 0.07 * Math.sin(t * s4 + o4);
        ctx.beginPath();
        for (let y = -10; y <= h + 10; y += 6) {
          const v = y / h;
          const x = cx + dx + base * amp * Math.sin(v * Math.PI * 1.6 + p1) + base * 0.35 * Math.sin(v * Math.PI * 3.1 + p2) - v * w * 0.05;
          if (y === -10) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (circuit) ctx.drawImage(circuit, 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      drawRibbon();
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${a.c},${((1 - d / LINK) * 0.25).toFixed(3)})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const pd = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (pd < LINK * 1.3) {
          ctx.strokeStyle = `rgba(${a.c},${((1 - pd / (LINK * 1.3)) * 0.6).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }
      for (const a of dots) {
        ctx.fillStyle = `rgba(${a.c},0.1)`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${a.c},0.9)`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const tick = () => {
      t += 0.0042;
      for (const a of dots) {
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < -20) a.x = w + 20;
        if (a.x > w + 20) a.x = -20;
        if (a.y < -20) a.y = h + 20;
        if (a.y > h + 20) a.y = -20;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const leave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (!still) {
      raf = requestAnimationFrame(tick);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerleave', leave);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <canvas ref={ref} className="lp-net" aria-hidden="true" />;
}
