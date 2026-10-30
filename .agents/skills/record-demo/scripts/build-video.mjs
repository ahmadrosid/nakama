// Turns recorded frames into an H.264 MP4.
//   bun build-video.mjs segments <frames-dir>
//   bun build-video.mjs build <frames-dir> <plan.json> <out.mp4>
//   bun build-video.mjs sheet <video.mp4> <out.jpg> [every-seconds]
//
// plan.json: { "segments": [{ "n": 1 }, { "n": 6, "speed": [[0, 4]] }, { "n": 10, "trim": 2.9 }],
//              "maxFrame": 0.4, "hold": 2.5, "width": 1920 }
// "speed" is a list of [from-second, factor]; "trim" drops the first seconds of a segment.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SEGMENT_GAP_MS = 2000;

function readSegments(framesDir) {
  const rows = readFileSync(join(framesDir, "index.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [name, time] = line.split(" ");
      return { name, time: Number(time) };
    })
    .filter((row) => row.time > 0);
  const segments = [[rows[0]]];

  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].time - rows[index - 1].time > SEGMENT_GAP_MS) {
      segments.push([]);
    }
    segments.at(-1).push(rows[index]);
  }

  return segments;
}

async function ffmpeg(args) {
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", ...args],
    {
      stderr: "inherit",
    }
  );

  if ((await proc.exited) !== 0) {
    throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  }
}

function listSegments(framesDir) {
  readSegments(framesDir).forEach((segment, index) => {
    const seconds = (segment.at(-1).time - segment[0].time) / 1000;
    console.log(
      `${index + 1}\t${segment[0].name}..${segment.at(-1).name}\t${seconds.toFixed(1)}s\t${segment.length} frames`
    );
  });
}

function frameList(framesDir, plan) {
  const segments = readSegments(framesDir);
  const maxFrame = plan.maxFrame ?? 0.4;
  const frames = [];

  for (const step of plan.segments) {
    const segment = segments[step.n - 1];
    const start = segment[0].time;
    const speed = step.speed ?? [[0, 1]];
    const kept = segment.filter(
      (row) => (row.time - start) / 1000 >= (step.trim ?? 0)
    );

    kept.forEach((row, index) => {
      const at = (row.time - start) / 1000;
      const factor = speed.filter(([from]) => at >= from).at(-1)?.[1] ?? 1;
      const gap =
        index + 1 < kept.length
          ? (kept[index + 1].time - row.time) / 1000
          : 0.08;

      frames.push({
        duration: Math.min(gap, maxFrame) / factor,
        name: row.name,
      });
    });
  }

  frames.at(-1).duration = plan.hold ?? 2.5;

  return frames;
}

async function build(framesDir, planPath, out) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const frames = frameList(framesDir, plan);
  const concatPath = join(dirname(out), "concat.txt");
  const relativeDir = relative(dirname(concatPath), framesDir);
  const lines = frames.flatMap((frame) => [
    `file '${join(relativeDir, frame.name)}'`,
    `duration ${frame.duration.toFixed(4)}`,
  ]);

  lines.push(`file '${join(relativeDir, frames.at(-1).name)}'`);
  writeFileSync(concatPath, `${lines.join("\n")}\n`);

  const width = plan.width ?? 1920;

  await ffmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-vf",
    `scale=${width}:-2:flags=lanczos,fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    out,
  ]);

  const seconds = frames.reduce((sum, frame) => sum + frame.duration, 0);
  console.log(`${out}: ${frames.length} frames, ${seconds.toFixed(1)}s`);
}

async function sheet(video, out, every = "6") {
  await ffmpeg([
    "-i",
    video,
    "-vf",
    `fps=1/${every},scale=480:-2,tile=4x6`,
    "-frames:v",
    "1",
    out,
  ]);
  console.log(out);
}

const [command, ...args] = process.argv.slice(2);

if (command === "segments") {
  listSegments(args[0]);
} else if (command === "build") {
  await build(args[0], args[1], args[2]);
} else if (command === "sheet") {
  await sheet(args[0], args[1], args[2]);
} else {
  console.error("Usage: bun build-video.mjs segments|build|sheet ...");
  process.exit(1);
}
