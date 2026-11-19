<script setup lang="ts">
// Anjalai, the fearless companion (the mascot): a small round friend with a cape in the brand's
// gradient, a heart shield, a confident wave, and a ring above its head with a star and dots. Drawn here as SVG, so it is
// sharp at any size and needs no image file. It floats gently, and holds still for people who prefer
// reduced motion.
withDefaults(defineProps<{ size?: number }>(), { size: 220 });
const uid = `anj-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <svg :width="size" :height="Math.round(size * 1.1)" viewBox="0 0 240 264" role="img" aria-label="Anjalai: a small round companion in a cape, waving, with a heart shield and a ring with a star above its head" class="anjalai">
    <defs>
      <linearGradient :id="`${uid}-cape`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6a1bd1" />
        <stop offset="0.55" stop-color="#c026d3" />
        <stop offset="1" stop-color="#f97316" />
      </linearGradient>
      <radialGradient :id="`${uid}-body`" cx="0.38" cy="0.32" r="0.8">
        <stop offset="0" stop-color="#fffaf3" />
        <stop offset="1" stop-color="#ffe2c4" />
      </radialGradient>
      <linearGradient :id="`${uid}-shield`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffd166" />
        <stop offset="1" stop-color="#f59e0b" />
      </linearGradient>
    </defs>

    <!-- Ground shadow -->
    <ellipse cx="120" cy="250" rx="62" ry="9" fill="#000" opacity="0.08" class="anjalai-shadow" />

    <g class="anjalai-body">
      <!-- Cape, fluttering behind -->
      <path d="M78 118 C 52 150, 40 200, 54 236 C 92 222, 128 236, 166 226 C 196 216, 214 196, 222 168 C 196 172, 176 160, 162 120 Z" :fill="`url(#${uid}-cape)`" />
      <path d="M54 236 C 64 228, 74 226, 84 230" stroke="#fff" stroke-opacity="0.35" stroke-width="3" fill="none" stroke-linecap="round" />

      <!-- A ring above the head, with a star and dots on it -->
      <ellipse cx="120" cy="34" rx="34" ry="9" fill="none" :stroke="`url(#${uid}-cape)`" stroke-width="4" />
      <path d="M120 16 l3.5 7 7.7 1.1 -5.6 5.4 1.3 7.7 -6.9 -3.6 -6.9 3.6 1.3 -7.7 -5.6 -5.4 7.7 -1.1 z" fill="#ffd166" stroke="#3b1f14" stroke-width="2" stroke-linejoin="round" class="anjalai-star" />
      <circle cx="88" cy="36" r="3.5" fill="#c026d3" />
      <circle cx="152" cy="36" r="3.5" fill="#f97316" />
      <circle cx="104" cy="42" r="2.5" fill="#6a1bd1" />
      <circle cx="137" cy="42" r="2.5" fill="#c026d3" />

      <!-- Body -->
      <path d="M120 52 C 168 52, 188 92, 188 142 C 188 194, 160 226, 120 226 C 80 226, 52 194, 52 142 C 52 92, 72 52, 120 52 Z" :fill="`url(#${uid}-body)`" stroke="#3b1f14" stroke-width="3.5" />

      <!-- The cape's clasps on the shoulders, and a star badge on the chest -->
      <circle cx="66" cy="128" r="6" fill="#c026d3" stroke="#3b1f14" stroke-width="2.5" />
      <circle cx="174" cy="128" r="6" fill="#c026d3" stroke="#3b1f14" stroke-width="2.5" />
      <path d="M120 146 l5 10 11 1.5 -8 7.5 2 11 -10 -5.5 -10 5.5 2 -11 -8 -7.5 11 -1.5 z" fill="#f97316" stroke="#3b1f14" stroke-width="2" stroke-linejoin="round" />

      <!-- Face -->
      <ellipse cx="100" cy="94" rx="9" ry="11" fill="#3b1f14" />
      <ellipse cx="140" cy="94" rx="9" ry="11" fill="#3b1f14" />
      <circle cx="103" cy="90" r="3.2" fill="#fff" />
      <circle cx="143" cy="90" r="3.2" fill="#fff" />
      <path d="M90 78 Q 100 72 110 77" stroke="#3b1f14" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M130 77 Q 140 72 150 78" stroke="#3b1f14" stroke-width="3" fill="none" stroke-linecap="round" />
      <ellipse cx="86" cy="108" rx="8" ry="5" fill="#fb7185" opacity="0.45" />
      <ellipse cx="154" cy="108" rx="8" ry="5" fill="#fb7185" opacity="0.45" />
      <path d="M106 108 Q 120 122 134 108" stroke="#3b1f14" stroke-width="3.5" fill="#fff" stroke-linejoin="round" stroke-linecap="round" />

      <!-- Waving arm -->
      <g class="anjalai-wave">
        <path d="M60 128 C 42 118, 34 100, 36 82" stroke="#3b1f14" stroke-width="3.5" fill="none" stroke-linecap="round" />
        <circle cx="36" cy="76" r="10" fill="#ffe2c4" stroke="#3b1f14" stroke-width="3" />
      </g>

      <!-- Arm with the heart shield -->
      <path d="M180 140 C 194 148, 200 160, 198 172" stroke="#3b1f14" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <path d="M176 156 L 216 156 C 216 186, 204 202, 196 208 C 188 202, 176 186, 176 156 Z" :fill="`url(#${uid}-shield)`" stroke="#3b1f14" stroke-width="3" stroke-linejoin="round" />
      <path d="M196 192 C 186 184, 184 178, 188 174 C 191 171, 195 172, 196 176 C 197 172, 201 171, 204 174 C 208 178, 206 184, 196 192 Z" fill="#e11d48" />

      <!-- Feet -->
      <ellipse cx="100" cy="230" rx="15" ry="8" fill="#3b1f14" />
      <ellipse cx="140" cy="230" rx="15" ry="8" fill="#3b1f14" />
    </g>
  </svg>
</template>

<style>
.anjalai .anjalai-body {
  animation: anjalai-float 4.5s ease-in-out infinite;
  transform-origin: 120px 240px;
}
.anjalai .anjalai-shadow {
  animation: anjalai-shadow 4.5s ease-in-out infinite;
  transform-origin: 120px 250px;
}
.anjalai .anjalai-star {
  animation: anjalai-twinkle 3s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes anjalai-twinkle {
  0%,
  100% {
    transform: scale(1) rotate(0deg);
  }
  50% {
    transform: scale(1.15) rotate(12deg);
  }
}
.anjalai .anjalai-wave {
  animation: anjalai-wave 2.4s ease-in-out infinite;
  transform-origin: 60px 128px;
}
@keyframes anjalai-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}
@keyframes anjalai-shadow {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 0.08;
  }
  50% {
    transform: scaleX(0.85);
    opacity: 0.05;
  }
}
@keyframes anjalai-wave {
  0%,
  60%,
  100% {
    transform: rotate(0deg);
  }
  20% {
    transform: rotate(-14deg);
  }
  40% {
    transform: rotate(8deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .anjalai .anjalai-body,
  .anjalai .anjalai-shadow,
  .anjalai .anjalai-star,
  .anjalai .anjalai-wave {
    animation: none;
  }
}
</style>
