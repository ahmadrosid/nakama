/* global chrome */

const chrome = globalThis.chrome;
let socket;
let context;
let streams = [];
let processor;
let stopping;
let flushed;
let finalized;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) {
    return;
  }
  if (message.type === "START_CAPTURE") {
    start(message.streamId, message.captureUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await fail(error);
        sendResponse({
          error: error.message,
          needsMicrophone: error.needsMicrophone === true,
        });
      });
    return true;
  }
  if (message.type === "STOP_CAPTURE") {
    void stop().then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function start(streamId, captureUrl) {
  stopping = undefined;
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });
  if (stopping) {
    for (const track of tab.getTracks()) {
      track.stop();
    }
    throw new Error("Capture stopped while starting");
  }
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
    if (stopping) {
      for (const track of mic.getTracks()) {
        track.stop();
      }
      throw new Error("Capture stopped while starting");
    }
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
  if (stopping) {
    throw new Error("Capture stopped while starting");
  }
  processor = new AudioWorkletNode(context, "nakama-pcm", {
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
  if (stopping) {
    throw new Error("Capture stopped while starting");
  }
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "capture-finalized") {
      finalized?.();
    }
    if (message.type === "stop-requested") {
      void stop();
    }
  };
  socket.onclose = (event) => {
    if (event.code >= 1008) {
      void fail(
        new Error(event.reason || "Transcription connection ended unexpectedly")
      );
    } else {
      stop();
    }
  };
  socket.onerror = () => fail(new Error("Nakama capture connection failed"));
  processor.port.onmessage = (event) => {
    if (event.data === "flushed") {
      flushed?.();
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (socket.bufferedAmount > 2_400_000) {
      void fail(new Error("Capture connection cannot keep up"));
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
  stopping ??= (async () => {
    let failure = typeof error === "string" ? error : undefined;
    try {
      if (!failure && socket?.readyState === WebSocket.OPEN && processor) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Final audio flush timed out")),
            2000
          );
          flushed = () => {
            clearTimeout(timer);
            resolve();
          };
          processor.port.postMessage("flush");
        });
        for (const stream of streams) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Capture confirmation timed out")),
            5000
          );
          finalized = () => {
            clearTimeout(timer);
            resolve();
          };
          socket.send(JSON.stringify({ protocol: 2, type: "stop" }));
        });
      }
    } catch (reason) {
      failure = reason.message;
    }
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    socket = undefined;
    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    streams = [];
    await context?.close();
    context = undefined;
    processor = undefined;
    flushed = finalized = undefined;
    await chrome.runtime.sendMessage(
      failure
        ? { error: failure, type: "CAPTURE_ERROR" }
        : { type: "CAPTURE_STOPPED" }
    );
  })();
  return stopping;
}

function fail(error) {
  return stop(error.message);
}
