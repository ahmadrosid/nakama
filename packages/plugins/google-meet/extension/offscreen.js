/* global chrome */

const chrome = globalThis.chrome;
let socket;
let context;
let streams = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) {
    return;
  }
  if (message.type === "START_CAPTURE") {
    start(message.streamId, message.captureUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        fail(error);
        sendResponse({
          error: error.message,
          needsMicrophone: error.needsMicrophone === true,
        });
      });
    return true;
  }
  if (message.type === "STOP_CAPTURE") {
    stop();
    sendResponse({ ok: true });
  }
});

async function start(streamId, captureUrl) {
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });
  streams = [tab];
  context = new AudioContext({ sampleRate: 24_000 });
  const mix = context.createGain();
  const tabAudio = context.createMediaStreamSource(tab);
  tabAudio.connect(mix);
  tabAudio.connect(context.destination);
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streams.push(mic);
    context.createMediaStreamSource(mic).connect(mix);
  } catch {
    const error = new Error(
      "Allow microphone access in the setup tab, then start transcription again."
    );
    error.needsMicrophone = true;
    throw error;
  }
  await context.audioWorklet.addModule(
    chrome.runtime.getURL("audio-worklet.js")
  );
  const processor = new AudioWorkletNode(context, "nakama-pcm", {
    channelCount: 1,
    channelCountMode: "explicit",
  });
  processor.onprocessorerror = () => fail(new Error("Audio processing failed"));
  processor.connect(context.destination);
  // Offscreen documents only expose chrome.runtime, not chrome.storage.
  socket = new WebSocket(captureUrl);
  socket.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Nakama capture connection timed out")),
      10_000
    );
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = socket.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Nakama capture connection failed"));
    };
  });
  socket.onclose = (event) => {
    if (event.code >= 1008) {
      fail(
        new Error(event.reason || "Transcription connection ended unexpectedly")
      );
    } else {
      stop();
    }
  };
  socket.onerror = () => fail(new Error("Nakama capture connection failed"));
  processor.port.onmessage = (event) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(event.data);
  };
  mix.connect(processor);
  await context.resume();
  tab.getAudioTracks().forEach((track) => {
    track.onended = stop;
  });
  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
}

function stop(error) {
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
  }
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
  chrome.runtime.sendMessage(
    typeof error === "string"
      ? { error, type: "CAPTURE_ERROR" }
      : { type: "CAPTURE_STOPPED" }
  );
}

function fail(error) {
  stop(error.message);
}
