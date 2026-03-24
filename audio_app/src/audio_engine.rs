use std::sync::mpsc::{Receiver, Sender, channel};
use std::f32::consts::TAU;

use oboe::{
    AudioOutputCallback, AudioOutputStreamSafe, AudioStream, AudioStreamAsync, AudioStreamBuilder,
    DataCallbackResult, Mono, Output, PerformanceMode, SharingMode,
};

pub struct AudioEngine {
    pub _device: AudioStreamAsync<Output, AudioProc>,
    pub tx: Sender<AudioCommand>,
}

pub fn audio_engine() -> AudioEngine {
    let (tx, rx) = channel::<AudioCommand>();

    let mut audio_proc_out = AudioStreamBuilder::default()
        .set_output()
        .set_performance_mode(PerformanceMode::LowLatency)
        .set_sharing_mode(SharingMode::Exclusive)
        .set_format::<f32>()
        .set_channel_count::<Mono>()
        .set_callback(AudioProc::new(rx))
        .open_stream()
        .unwrap();

    audio_proc_out.start().unwrap();

    AudioEngine {
        _device: audio_proc_out,
        tx,
    }
}

pub enum AudioCommand {
    SetFreq(f32),
}

pub struct AudioProc {
    sr: f32,
    freq: f32,
    phase: f32,
    receiver: Receiver<AudioCommand>,
}

impl AudioProc {
    pub fn new(rx: Receiver<AudioCommand>) -> Self {
        Self {
            sr: 48000.0,
            freq: 100.0,
            phase: 0.0,
            receiver: rx,
        }
    }

    fn tick(&mut self) -> f32 {
        let sample = 0.2 * self.phase.sin();
        self.phase = (self.phase + TAU * self.freq / self.sr) % TAU;
        sample
    }

    fn process(&mut self, outbuf: *mut f32, sz: usize) {
        let outbuf: &mut [f32] = unsafe { std::slice::from_raw_parts_mut(outbuf, sz) };
        for n in 0..sz {
            outbuf[n] = self.tick();
        }
    }
}

impl AudioOutputCallback for AudioProc {
    type FrameType = (f32, Mono);

    fn on_audio_ready(
        &mut self,
        stream: &mut dyn AudioOutputStreamSafe,
        frames: &mut [f32],
    ) -> DataCallbackResult {
        self.sr = stream.get_sample_rate() as f32;

        while let Ok(cmd) = self.receiver.try_recv() {
            match cmd {
                AudioCommand::SetFreq(f) => self.freq = f,
            }
        }

        self.process(frames.as_mut_ptr(), frames.len());

        DataCallbackResult::Continue
    }
}
