// Sprites drawn at load time instead of shipped as images, in the same
// line-art style as spaceship.png. The canvases are uploaded as textures.

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return [canvas, canvas.getContext('2d')];
}

export function drawSaucer() {
  const [canvas, ctx] = makeCanvas(256);
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round';

  // dome
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(128, 118, 48, 44, 0, Math.PI, 2 * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // hull
  ctx.beginPath();
  ctx.ellipse(128, 136, 112, 34, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(30, 128);
  ctx.lineTo(226, 128);
  ctx.stroke();

  // lights
  ctx.fillStyle = '#e36d8e';
  for (const x of [72, 128, 184]) {
    ctx.beginPath();
    ctx.arc(x, 148, 11, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  return canvas;
}

export function drawEnemyLaser() {
  const [canvas, ctx] = makeCanvas(64);
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 14);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.35, 'rgba(255, 70, 110, 1)');
  glow.addColorStop(1, 'rgba(255, 70, 110, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}
