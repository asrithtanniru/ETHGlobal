// Thermal printer sound, synthesised so there is no audio file to ship.
// The timing mirrors printer-feed in globals.css: the paper moves for 7.5% of the feed, then rests for 3%.
const FEED_SECONDS = 1.75;
const STEP = 0.105;
const MOVE = 0.075;

export function schedulePrintSound(ctx: BaseAudioContext, at: number) {
  const end = at + FEED_SECONDS;
  const out = new GainNode(ctx, { gain: 0.3 });
  const gate = new GainNode(ctx, { gain: 0 });
  const clicks = new GainNode(ctx, { gain: 0 });
  gate.connect(out);
  clicks.connect(out);
  out.connect(ctx.destination);

  // Stepper motor: a square tone through a narrow band, buzzed by the print head firing line by line.
  const motor = new OscillatorNode(ctx, { type: "square", frequency: 620 });
  const buzz = new GainNode(ctx, { gain: 0.5 });
  const head = new OscillatorNode(ctx, { type: "square", frequency: 145 });
  const headDepth = new GainNode(ctx, { gain: 0.5 });
  head.connect(headDepth).connect(buzz.gain);
  motor.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1300, Q: 2.5 })).connect(buzz).connect(gate);

  // The plastic case resonating under the motor.
  const body = new OscillatorNode(ctx, { type: "triangle", frequency: 118 });
  body.connect(new GainNode(ctx, { gain: 0.3 })).connect(gate);

  // Paper dragging across the head, and the small clicks of the gears stopping.
  const noise = new AudioBuffer({ length: Math.ceil(ctx.sampleRate * (FEED_SECONDS + 0.2)), sampleRate: ctx.sampleRate });
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const paper = new AudioBufferSourceNode(ctx, { buffer: noise });
  paper.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 3800, Q: 0.7 })).connect(new GainNode(ctx, { gain: 0.45 })).connect(gate);
  paper.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1900, Q: 1.2 })).connect(clicks);

  for (let step = 0; step < 1; step += STEP) {
    const start = at + step * FEED_SECONDS;
    const stop = at + Math.min(step + MOVE, 1) * FEED_SECONDS;
    // No two steps of a real motor land on quite the same pitch.
    motor.frequency.setValueAtTime(620 * (0.96 + Math.random() * 0.08), start);
    gate.gain.setValueAtTime(0, start);
    gate.gain.linearRampToValueAtTime(1, start + 0.006);
    gate.gain.setValueAtTime(1, stop - 0.012);
    gate.gain.linearRampToValueAtTime(0, stop);
    clicks.gain.setValueAtTime(1.6, stop);
    clicks.gain.exponentialRampToValueAtTime(0.001, stop + 0.018);
    clicks.gain.setValueAtTime(0, stop + 0.018);
  }

  for (const node of [motor, head, body, paper]) {
    node.start(at);
    node.stop(end + 0.1);
  }
}

/** Plays once and returns a stop function. Stays silent when the browser blocks audio: the receipt must still print. */
export function playPrintSound() {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  let live = true;
  const stop = () => {
    if (!live) return;
    live = false;
    clearTimeout(timer);
    void ctx.close();
  };
  // A blocked context never resumes, so the timer closes it. Otherwise a later tap would play the sound late.
  const timer = setTimeout(stop, (FEED_SECONDS + 0.3) * 1000);
  ctx.resume().then(() => { if (live) schedulePrintSound(ctx, ctx.currentTime); }).catch(() => {});
  return stop;
}
