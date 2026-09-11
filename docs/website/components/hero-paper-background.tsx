"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/base-path";

/*
 * Dot rendering adapted from Holocron's VideoBackgroundShader:
 * https://github.com/remorses/holocron/blob/main/vite/src/components/markdown/video-background-shader.tsx
 * Video: https://github.com/remorses/playwriter/blob/main/website/public/assets/hero-bg.mp4
 *
 * MIT License
 * Copyright (c) 2025 Tommy Morelli (remorses)
 * Copyright (c) 2026 Tommy D. Rossi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const VERTEX = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT = `
  precision mediump float;
  uniform sampler2D video;
  uniform vec2 resolution;
  uniform float time;
  varying vec2 uv;
  void main() {
    vec2 pixel = uv * resolution;
    vec2 cell = floor(pixel / 7.0);
    vec2 sampleUv = (cell + 0.5) * 7.0 / resolution;
    vec3 color = pow(texture2D(video, sampleUv).rgb, vec3(0.8));
    float brightness = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float phase = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
    float pulse = 0.75 + 0.25 * sin(time * 3.0 + phase);
    float radius = mix(0.5, 3.0, brightness) * pulse;
    float distanceToCenter = length(mod(pixel, 7.0) - 3.5);
    float dotMask = 1.0 - smoothstep(radius - 0.5, radius + 0.5, distanceToCenter);
    float alpha = dotMask * brightness * smoothstep(0.0, 0.1, brightness) * 0.49;
    gl_FragColor = vec4(vec3(1.0, 0.416, 0.0) * alpha, alpha);
  }
`;

export function HeroPaperBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) {
      return;
    }
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const video = document.createElement("video");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = false;
    let disposed = false;
    let failed = false;
    let previousFrame = 0;

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      video.pause();
    }

    function draw(now: number) {
      if (!gl || disposed || failed || video.readyState < 2) {
        return;
      }
      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          video
        );
        gl.uniform1f(
          gl.getUniformLocation(program!, "time"),
          motion.matches ? 0 : now / 1000
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        container!.dataset.ready = "true";
      } catch {
        failed = true;
        delete container!.dataset.ready;
        stop();
      }
    }

    function animate(now: number) {
      frame = 0;
      if (disposed || failed || !visible || document.hidden || motion.matches) {
        return;
      }
      if (now - previousFrame >= 1000 / 30) {
        draw(now);
        previousFrame = now;
      }
      if (!failed) {
        frame = requestAnimationFrame(animate);
      }
    }

    function syncPlayback() {
      stop();
      if (disposed || failed || !visible || document.hidden) {
        return;
      }
      draw(performance.now());
      if (!(motion.matches || failed)) {
        // Autoplay can be refused in low-power mode; keep the still frame.
        video
          .play()
          .then(() => {
            if (
              disposed ||
              !visible ||
              document.hidden ||
              motion.matches ||
              failed
            ) {
              video.pause();
            } else if (!frame) {
              frame = requestAnimationFrame(animate);
            }
          })
          .catch(() => {});
      }
    }

    function resize() {
      if (!(gl && program)) {
        return;
      }
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(
        gl.getUniformLocation(program, "resolution"),
        Math.max(1, width),
        Math.max(1, height)
      );
      draw(performance.now());
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      failed = true;
      delete container!.dataset.ready;
      stop();
    }

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      syncPlayback();
    });
    const observer = new ResizeObserver(resize);

    try {
      if (!(program && buffer && texture)) {
        throw new Error("WebGL unavailable");
      }
      for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX],
        [gl.FRAGMENT_SHADER, FRAGMENT],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) {
          throw new Error("WebGL unavailable");
        }
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error("Shader compilation failed");
        }
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("Shader linking failed");
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.addEventListener("loadeddata", syncPlayback);
      video.src = withBasePath("/hero-dots.mp4");
      canvas.addEventListener("webglcontextlost", onContextLost);
      container.appendChild(canvas);
      resize();
      observer.observe(container);
      intersection.observe(container);
      motion.addEventListener("change", syncPlayback);
      document.addEventListener("visibilitychange", syncPlayback);
    } catch {
      failed = true;
    }

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      video.removeEventListener("loadeddata", syncPlayback);
      video.removeAttribute("src");
      video.load();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      for (const shader of shaders) {
        gl.deleteShader(shader);
      }
      canvas.remove();
      delete container.dataset.ready;
    };
  }, []);

  return (
    <div
      aria-hidden
      className="hero-dots pointer-events-none absolute inset-0"
      ref={ref}
    />
  );
}
