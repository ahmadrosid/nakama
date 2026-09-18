/* global chrome */

const chrome = globalThis.chrome;
let socket;
let context;
let streams = [];

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_CAPTURE") {
    start(message.streamId).catch(fail);
  }
  if (message.type === "STOP_CAPTURE") {
    stop();
  }
});

async function start(streamId) {
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });
  streams = [tab];
  context = new AudioContext();
  const mix = context.createGain();
  context.createMediaStreamSource(tab).connect(mix);
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streams.push(mic);
    context.createMediaStreamSource(mic).connect(mix);
  } catch {}
  mix.connect(context.destination);
  const processor = context.createScriptProcessor(4096, 2, 1);
  mix.connect(processor);
  processor.connect(context.destination);
  const { captureSession } = await chrome.storage.session.get("captureSession");
  socket = new WebSocket(captureSession.captureUrl);
  socket.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () =>
      reject(new Error("Nakama capture connection failed"));
  });
  processor.onaudioprocess = (event) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const input = event.inputBuffer.getChannelData(0);
    const output = new Int16Array(Math.floor(input.length / 2));
    for (let i = 0; i < output.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i * 2]));
      output[i] = sample < 0 ? sample * 32_768 : sample * 32_767;
    }
    socket.send(output);
  };
  tab.getAudioTracks().forEach((track) => {
    track.onended = stop;
  });
  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
}

function stop() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "stop" }));
  }
  socket?.close();
  socket = undefined;
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  streams = [];
  context?.close();
  context = undefined;
  chrome.runtime.sendMessage({ type: "CAPTURE_STOPPED" });
}

function fail(error) {
  stop();
  chrome.runtime.sendMessage({ error: error.message, type: "CAPTURE_ERROR" });
}
