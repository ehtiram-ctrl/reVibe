"use client";

import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

function MatrixRainOverlay({ isMax }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const chars = "01アイウエオカキクケコABCDEF9876543210#$@";
    const fontSize = 13;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = Array(columns).fill(1);

    const interval = setInterval(() => {
      ctx.fillStyle = isMax ? "rgba(18, 2, 4, 0.18)" : "rgba(0, 15, 8, 0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = isMax ? "#ef4444" : "#10b981";
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.96) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }, 45);

    return () => clearInterval(interval);
  }, [isMax]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-80 mix-blend-screen"
    />
  );
}

const LOG_STEPS = [
  "METADATA_STRIP → OK",
  "HASH_SIGNATURE → RESET",
  "FRAME_MATRIX → SHIFTED",
  "AUDIO_PITCH → MODIFIED",
  "COLOR_LUT → CALIBRATED",
  "BITRATE_BOOST → ACTIVE",
];

export default function Home() {
  const [videoFile, setVideoFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [mode, setMode] = useState("medium");
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [smoothFps, setSmoothFps] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [logIndex, setLogIndex] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [outputSizeMB, setOutputSizeMB] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [sliderPos, setSliderPos] = useState(50);

  const ffmpegRef = useRef(null);
  const beforeVideoRef = useRef(null);
  const afterVideoRef = useRef(null);

  const isMax = mode === "max";

  useEffect(() => {
    if (status !== "processing") return;
    const timer = setInterval(() => {
      setLogIndex((prev) => (prev + 1) % LOG_STEPS.length);
    }, 750);
    return () => clearInterval(timer);
  }, [status]);

  const handleFileChange = (file) => {
    if (!file) return;
    setVideoFile(file);
    setOutputUrl(null);
    setOutputSizeMB(null);
    setProgress(0);
    setStatus("idle");
    setErrorMsg("");
    setSliderPos(50);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;

    setStatus("loading-ffmpeg");
    const ffmpeg = new FFmpeg();

    ffmpeg.on("progress", ({ progress }) => {
      const pct = Math.min(99, Math.max(2, Math.round(progress * 100)));
      setProgress(pct);
    });

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const handleProcess = async () => {
    if (!videoFile) return;

    try {
      setErrorMsg("");
      setOutputUrl(null);
      setProgress(1);

      const ffmpeg = await loadFFmpeg();
      setStatus("processing");

      const inputName = "input.mp4";
      const outputName = "revibe_output.mp4";

      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      let vfParts = [];
      let af = "";

      if (mode === "light") {
        vfParts.push("crop=iw*0.98:ih*0.98,scale=iw:ih,eq=contrast=1.02:saturation=1.03,setpts=0.99*PTS");
        af = "atempo=1.01";
      } else if (mode === "medium") {
        vfParts.push("crop=iw*0.96:ih*0.96,scale=iw:ih,eq=contrast=1.04:brightness=0.01:saturation=1.06,setpts=0.98*PTS");
        af = "asetrate=44100*1.015,aresample=44100,atempo=1.005";
      } else if (mode === "deep") {
        vfParts.push("crop=iw*0.94:ih*0.94,scale=iw:ih,eq=contrast=1.06:brightness=0.015:saturation=1.08,noise=alls=2:allf=t,setpts=0.97*PTS");
        af = "asetrate=44100*1.025,aresample=44100,atempo=1.005";
      } else {
        // MAX rejimi: 8% kəsim + mikro rəng tonu + canlı kontrast + 1.04x sürət + zərif tekstura
        vfParts.push("crop=iw*0.92:ih*0.92,scale=iw:ih,hue=h=3:s=1.12,eq=contrast=1.09:brightness=0.02,noise=alls=3:allf=t,setpts=0.96*PTS");
        af = "asetrate=44100*1.035,aresample=44100,atempo=1.006";
      }

      if (flipHorizontal) {
        vfParts.push("hflip");
      }

      if (smoothFps) {
        vfParts.push("fps=60");
      }

      await ffmpeg.exec([
        "-i", inputName,
        "-map_metadata", "-1",
        "-vf", vfParts.join(","),
        "-af", af,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        outputName,
      ]);

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setProgress(100);
      setOutputSizeMB((blob.size / (1024 * 1024)).toFixed(2));
      setOutputUrl(url);
      setStatus("done");
    } catch (err) {
      console.error(err);
      setErrorMsg("İşlem sırasında hata oluştu. Farklı bir .mp4 dosyası deneyin.");
      setStatus("error");
    }
  };

  const syncPlayPause = () => {
    const b = beforeVideoRef.current;
    const a = afterVideoRef.current;
    if (!b || !a) return;
    if (a.paused) {
      b.currentTime = a.currentTime;
      a.play();
      b.play();
    } else {
      a.pause();
      b.pause();
    }
  };

  const isWorking = status === "loading-ffmpeg" || status === "processing";

  return (
    <main className="min-h-screen bg-[#060908] text-zinc-100 flex flex-col justify-between p-4 sm:p-6 relative overflow-hidden">
      <div
        className={`absolute top-[-15%] left-1/2 -translate-x-1/2 w-[520px] h-[320px] blur-[130px] rounded-full pointer-events-none transition-colors duration-500 ${
          isMax ? "bg-red-500/15" : "bg-emerald-500/10"
        }`}
      />

      {/* Minimalist Üst Bar */}
      <header className="w-full max-w-md mx-auto flex items-center justify-between pt-1 pb-4 relative z-10">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 64 64"
            className="w-7 h-7 rounded-lg shadow-md shadow-emerald-500/20 shrink-0"
          >
            <defs>
              <linearGradient id="revibeTopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#0d9488" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="16" fill="url(#revibeTopGrad)" />
            <path
              d="M21 45V19h13.5c5.2 0 8.5 3 8.5 7.6 0 3.6-2.1 6.3-5.4 7.1L44 45h-6.6l-5.6-10.4H27V45h-6zm6-15h7c2.1 0 3.3-1.1 3.3-2.9 0-1.8-1.2-2.9-3.3-2.9h-7V30z"
              fill="#060908"
            />
            <path
              d="M47 17l3.5 3.5-3.5 3.5"
              fill="none"
              stroke="#060908"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-emerald-400 bg-clip-text text-transparent">
            ReVibe
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>100% Gizli • Tarayıcıda İşlenir</span>
        </div>
      </header>

      {/* Ana Kart */}
      <div
        className={`w-full max-w-md mx-auto bg-zinc-900/80 backdrop-blur-xl border rounded-3xl p-5 sm:p-6 relative z-10 my-auto transition-all duration-300 ${
          isMax
            ? "border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.1)]"
            : "border-zinc-800/90 shadow-[0_0_50px_rgba(16,185,129,0.07)]"
        }`}
      >
        {/* Video Alanı */}
        {!previewUrl ? (
          <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-zinc-700/80 hover:border-emerald-500/70 rounded-2xl cursor-pointer bg-zinc-950/60 transition group mb-5">
            <div className="w-11 h-11 rounded-full bg-zinc-900 border border-zinc-800 group-hover:border-emerald-500/40 flex items-center justify-center mb-2.5 transition">
              <span className="text-emerald-400 text-lg">↑</span>
            </div>
            <p className="text-sm font-semibold text-zinc-200">Video Seç</p>
            <input
              type="file"
              accept="video/mp4,video/*"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="relative w-full h-64 sm:h-72 rounded-2xl overflow-hidden bg-black border border-zinc-800 mb-5 flex items-center justify-center select-none">
            {status === "done" && outputUrl ? (
              <div
                onClick={syncPlayPause}
                className="relative w-full h-full cursor-pointer group"
                title="Oynat / Duraklat"
              >
                <video
                  ref={afterVideoRef}
                  src={outputUrl}
                  loop
                  playsInline
                  autoPlay
                  muted
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />

                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                >
                  <video
                    ref={beforeVideoRef}
                    src={previewUrl}
                    loop
                    playsInline
                    autoPlay
                    muted
                    className="w-full h-full object-contain bg-black"
                  />
                </div>

                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)] pointer-events-none"
                  style={{ left: `${sliderPos}%` }}
                >
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-zinc-950 border-2 border-emerald-400 flex items-center justify-center text-[10px] text-emerald-400 font-bold shadow-lg">
                    ⇄
                  </div>
                </div>

                <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-zinc-950/80 text-[10px] font-medium text-zinc-300 border border-zinc-800 pointer-events-none">
                  Önce
                </span>
                <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30 pointer-events-none">
                  ReVibe
                </span>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sliderPos}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setSliderPos(Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                />
              </div>
            ) : (
              <>
                <video
                  src={previewUrl}
                  muted
                  playsInline
                  className={`w-full h-full object-contain transition-all duration-500 ${
                    isWorking
                      ? "opacity-35 blur-[2px] scale-[1.01]"
                      : `opacity-80 ${flipHorizontal ? "-scale-x-100" : ""}`
                  }`}
                />

                {isWorking && (
                  <div
                    className={`absolute bottom-0 left-0 right-0 border-t-2 transition-all duration-300 ease-out ${
                      isMax
                        ? "bg-gradient-to-t from-red-600/55 via-red-500/35 to-red-400/20 border-red-400 shadow-[0_-8px_25px_rgba(239,68,68,0.5)]"
                        : "bg-gradient-to-t from-emerald-600/55 via-emerald-500/35 to-emerald-400/20 border-emerald-400 shadow-[0_-8px_25px_rgba(16,185,129,0.5)]"
                    }`}
                    style={{ height: `${progress}%` }}
                  />
                )}

                {isWorking && <MatrixRainOverlay isMax={isMax} />}

                {isWorking && (
                  <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div
                      className={`px-5 py-3 rounded-2xl bg-zinc-950/85 backdrop-blur-md border text-center shadow-xl min-w-[180px] ${
                        isMax ? "border-red-500/40" : "border-emerald-500/40"
                      }`}
                    >
                      <div
                        className={`text-2xl font-mono font-bold ${
                          isMax ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {status === "loading-ffmpeg" ? "..." : `${progress}%`}
                      </div>
                      <div
                        className={`text-[10px] font-mono mt-1 tracking-wider ${
                          isMax ? "text-red-300/80" : "text-emerald-300/80"
                        }`}
                      >
                        {status === "loading-ffmpeg"
                          ? "ENGINE_BOOT..."
                          : LOG_STEPS[logIndex]}
                      </div>
                    </div>
                  </div>
                )}

                {!isWorking && (
                  <label className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 cursor-pointer backdrop-blur-md transition">
                    Değiştir
                    <input
                      type="file"
                      accept="video/mp4,video/*"
                      className="hidden"
                      onChange={(e) => handleFileChange(e.target.files?.[0])}
                    />
                  </label>
                )}
              </>
            )}
          </div>
        )}

        {/* Seviye Seçimi (4 Düymə: Hafif, Orta, Güçlü, MAX) */}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {[
            { id: "light", title: "Hafif", desc: "Doğal" },
            { id: "medium", title: "Orta", desc: "Önerilen" },
            { id: "deep", title: "Güçlü", desc: "Yüksek" },
            { id: "max", title: "MAX", desc: "Ekstrem" },
          ].map((item) => {
            const active = mode === item.id;
            const isMaxBtn = item.id === "max";

            let btnStyle =
              "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700";

            if (active && isMaxBtn) {
              btnStyle =
                "border-red-500 bg-red-500/15 text-red-100 shadow-[0_0_22px_rgba(239,68,68,0.28)]";
            } else if (active) {
              btnStyle =
                "border-emerald-500 bg-emerald-500/10 text-white shadow-[0_0_20px_rgba(16,185,129,0.12)]";
            } else if (isMaxBtn) {
              btnStyle =
                "border-red-950/80 bg-zinc-950/60 text-red-400/80 hover:border-red-500/50";
            }

            return (
              <button
                key={item.id}
                type="button"
                disabled={isWorking}
                onClick={() => setMode(item.id)}
                className={`py-2.5 px-1.5 rounded-xl border text-center transition cursor-pointer disabled:opacity-50 ${btnStyle}`}
              >
                <div className="text-xs sm:text-sm font-bold tracking-tight">
                  {item.title}
                </div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    active && isMaxBtn ? "text-red-300" : "opacity-70"
                  }`}
                >
                  {item.desc}
                </div>
              </button>
            );
          })}
        </div>

        {/* Ekstra Hızlı Seçenekler (Ayna & 60 FPS) */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            disabled={isWorking}
            onClick={() => setFlipHorizontal((v) => !v)}
            className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 ${
              flipHorizontal
                ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            <span>⇄</span>
            <span>Ayna (Flip)</span>
          </button>

          <button
            type="button"
            disabled={isWorking}
            onClick={() => setSmoothFps((v) => !v)}
            className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 ${
              smoothFps
                ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            <span>⚡</span>
            <span>60 FPS</span>
          </button>
        </div>

        {/* Başlat Butonu */}
        {status !== "done" && (
          <button
            onClick={handleProcess}
            disabled={!videoFile || isWorking}
            className={`w-full py-3.5 rounded-xl disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 font-bold transition shadow-lg disabled:shadow-none cursor-pointer ${
              isMax
                ? "bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 text-white shadow-red-500/25"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 shadow-emerald-500/20"
            }`}
          >
            {status === "loading-ffmpeg"
              ? "Hazırlanıyor..."
              : status === "processing"
              ? `İşleniyor... ${progress}%`
              : isMax
              ? "MAX Özgünleştir"
              : "Özgünleştir"}
          </button>
        )}

        {/* Hata Mesajı */}
        {status === "error" && (
          <p className="text-red-400 text-xs text-center mt-4">{errorMsg}</p>
        )}

        {/* Sonuç ve İndirme */}
        {status === "done" && outputUrl && (
          <div className="space-y-3.5">
            <div className="p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 grid grid-cols-2 gap-2 text-xs">
              <div className="text-emerald-400 flex items-center gap-1.5">
                <span>✓</span> Metadata sıfırlandı
              </div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <span>✓</span> Yeni Hash oluşturuldu
              </div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <span>✓</span> Ses frekansı değişti
              </div>
              <div className="text-zinc-300 font-mono">
                {(videoFile.size / (1024 * 1024)).toFixed(2)} MB →{" "}
                <span className="text-emerald-400 font-bold">{outputSizeMB} MB</span>
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setOutputUrl(null);
                  setProgress(0);
                }}
                className="px-4 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-semibold transition cursor-pointer"
              >
                Tekrar
              </button>
              <a
                href={outputUrl}
                download={`revibe_${videoFile?.name || "video.mp4"}`}
                className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 text-center font-bold transition shadow-lg shadow-emerald-500/20"
              >
                Videoyu İndir
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Minimalist Alt İmza */}
      <footer className="w-full max-w-md mx-auto text-center pt-4 pb-1 text-[11px] text-zinc-600 relative z-10">
        ReVibe • Tüm hakları saklıdır
      </footer>
    </main>
  );
}
