/**
 * Live transcription is an interface so the engine can be swapped (e.g. for local whisper.cpp,
 * which runs on the server after upload — see server/transcribe/).
 */
export interface LiveTranscriber {
  readonly id: string;
  readonly available: boolean;
  start(onUpdate: (finalText: string, interim: string) => void): void;
  stop(): Promise<string>;
}

class WebSpeechTranscriber implements LiveTranscriber {
  id = 'browser';
  private rec: any = null;
  private finalText = '';
  private running = false;
  private onUpdate: (f: string, i: string) => void = () => {};
  get available() { return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition); }

  start(onUpdate: (finalText: string, interim: string) => void) {
    if (!this.available) return;
    this.onUpdate = onUpdate; this.finalText = ''; this.running = true;
    this.spawn();
  }
  private spawn() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText = (this.finalText + ' ' + r[0].transcript).trim();
        else interim += r[0].transcript;
      }
      this.onUpdate(this.finalText, interim.trim());
    };
    rec.onerror = () => {};
    // Chrome ends recognition after silence; keep it going for the whole note.
    rec.onend = () => { if (this.running) { try { this.spawn(); } catch { /* */ } } };
    try { rec.start(); } catch { /* */ }
    this.rec = rec;
  }
  stop(): Promise<string> {
    this.running = false;
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(this.finalText);
      const done = () => resolve(this.finalText.trim());
      rec.onend = done;
      setTimeout(done, 900);
      try { rec.stop(); } catch { done(); }
    });
  }
}

class NoopTranscriber implements LiveTranscriber {
  id = 'off'; available = false;
  start() {}
  async stop() { return ''; }
}

export function createTranscriber(engine: string): LiveTranscriber {
  if (engine === 'browser') return new WebSpeechTranscriber();
  return new NoopTranscriber(); // 'whisper' transcribes server-side after upload
}
