// 庆祝特效：彩纸
export function confetti(x = window.innerWidth / 2, y = window.innerHeight * 0.55, n = 28) {
  const cols = ['#ffd23f', '#ff7a6b', '#3fa0ff', '#12c28c', '#8b5cf6', '#ff9ecb'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    const w = 8 + Math.random() * 8;
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${Math.random() < 0.5 ? w : w * 0.5}px;background:${cols[i % cols.length]};border:2px solid #2b2350;border-radius:${Math.random() < 0.4 ? '50%' : '3px'};z-index:90;pointer-events:none`;
    document.body.appendChild(el);
    const a = Math.random() * Math.PI * 2;
    const d = 70 + Math.random() * 150;
    const rot = (Math.random() - 0.5) * 720;
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d - 70;
    el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) rotate(${rot / 2}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.1}px,${dy + 150}px) rotate(${rot}deg) scale(.9)`, opacity: 0 },
      ],
      { duration: 1000 + Math.random() * 600, easing: 'cubic-bezier(.2,.8,.3,1)' },
    ).onfinish = () => el.remove();
  }
}
