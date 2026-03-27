"use client";

import { useEffect, useState } from "react";

export function SplashScreen() {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Start fade-out after animation completes (~4s)
    const fadeTimer = setTimeout(() => setFading(true), 4000);
    // Remove from DOM after fade finishes (0.7s fade)
    const removeTimer = setTimeout(() => setGone(true), 4700);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#0A0E1A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        transition: "opacity 0.7s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "all",
      }}
    >
      <style>{`
        @keyframes pinDrop {
          0%   { opacity: 0; transform: scale(0.15) translateY(-50px); }
          55%  { opacity: 1; transform: scale(1.12) translateY(6px); }
          75%  { transform: scale(0.95) translateY(-2px); }
          90%  { transform: scale(1.03) translateY(1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes splashFadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes splashSlideUp {
          0%   { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes radiate {
          0%   { opacity: 0.9; transform: scale(0); }
          15%  { opacity: 1; }
          100% { opacity: 0; transform: scale(1); }
        }

        .sp-pin-body {
          opacity: 0;
          transform-origin: 32px 64px;
          animation: pinDrop 0.65s cubic-bezier(0.34, 1.4, 0.64, 1) 0.4s forwards;
        }
        .sp-pin-hole {
          opacity: 0;
          animation: splashFadeIn 0.25s ease-out 0.92s forwards;
        }
        .sp-ripple {
          opacity: 0;
          transform: scale(0);
          transform-origin: 32px 64px;
        }
        .sp-r1 { animation: radiate 1.6s ease-out 1.0s  forwards; }
        .sp-r2 { animation: radiate 1.6s ease-out 1.35s forwards; }
        .sp-r3 { animation: radiate 1.6s ease-out 1.7s  forwards; }
        .sp-r4 { animation: radiate 1.6s ease-out 2.05s forwards; }

        .sp-sr1 { opacity: 0; animation: splashFadeIn 0.5s ease 2.5s  forwards; }
        .sp-sr2 { opacity: 0; animation: splashFadeIn 0.5s ease 2.65s forwards; }
        .sp-sr3 { opacity: 0; animation: splashFadeIn 0.5s ease 2.8s  forwards; }

        .sp-wordmark {
          opacity: 0;
          transform: translateY(12px);
          animation: splashSlideUp 0.65s cubic-bezier(0.22, 1, 0.36, 1) 2.8s forwards;
        }
        .sp-sub {
          opacity: 0;
          animation: splashFadeIn 0.6s ease 3.3s forwards;
        }
        .sp-hint {
          opacity: 0;
          animation: splashFadeIn 0.4s ease 3.8s forwards;
        }
      `}</style>

      {/* Pin SVG */}
      <svg
        width="96"
        height="120"
        viewBox="0 0 64 84"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        overflow="visible"
        style={{ display: "block" }}
      >
        {/* Travelling ripples */}
        <ellipse className="sp-ripple sp-r1" cx="32" cy="64" rx="28" ry="9" stroke="#3D8EF5" strokeWidth="1.5" fill="none"/>
        <ellipse className="sp-ripple sp-r2" cx="32" cy="64" rx="28" ry="9" stroke="#3D8EF5" strokeWidth="1.5" fill="none"/>
        <ellipse className="sp-ripple sp-r3" cx="32" cy="64" rx="28" ry="9" stroke="#3D8EF5" strokeWidth="1.5" fill="none"/>
        <ellipse className="sp-ripple sp-r4" cx="32" cy="64" rx="28" ry="9" stroke="#3D8EF5" strokeWidth="1.5" fill="none"/>

        {/* Static rings — fade to their final opacities */}
        <ellipse className="sp-sr3" cx="32" cy="66" rx="22" ry="6"   stroke="#3D8EF5" strokeWidth="1.5" fill="none" style={{ opacity: 0 }}/>
        <ellipse className="sp-sr2" cx="32" cy="66" rx="15" ry="4"   stroke="#3D8EF5" strokeWidth="1.5" fill="none" style={{ opacity: 0 }}/>
        <ellipse className="sp-sr1" cx="32" cy="66" rx="8"  ry="2.5" stroke="#3D8EF5" strokeWidth="1.5" fill="none" style={{ opacity: 0 }}/>

        {/* Pin body */}
        <g className="sp-pin-body">
          <path d="M32 6C21.5 6 13 14.5 13 25C13 39 32 64 32 64C32 64 51 39 51 25C51 14.5 42.5 6 32 6Z" fill="#3D8EF5"/>
        </g>
        {/* Pin hole */}
        <g className="sp-pin-hole">
          <circle cx="32" cy="25" r="8" fill="#0A0E1A"/>
        </g>
      </svg>

      {/* Wordmark */}
      <div className="sp-wordmark" style={{ marginTop: "26px", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontWeight: 800,
            fontSize: "38px",
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "#F8FAFF",
          }}
        >
          WYNDOS<span style={{ color: "#3D8EF5" }}>.io</span>
        </div>
        <div
          className="sp-sub"
          style={{
            fontFamily: "var(--font-dm-mono), monospace",
            fontSize: "10px",
            letterSpacing: "0.14em",
            color: "#4A5568",
            textTransform: "uppercase",
            marginTop: "8px",
          }}
        >
          Route management · Planning
        </div>
      </div>

      {/* Hint */}
      <div
        className="sp-hint"
        style={{
          position: "absolute",
          bottom: "14px",
          right: "18px",
          fontFamily: "var(--font-dm-mono), monospace",
          fontSize: "9px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#1E2A3A",
        }}
      >
        Loading…
      </div>
    </div>
  );
}
