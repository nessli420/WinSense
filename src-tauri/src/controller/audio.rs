use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::{lock_state, AudioSettings, ConnectionTransport, ControllerState};

const BT_SPEAKER_TEST_DURATION_MS: usize = 1600;
const BT_SPEAKER_TEST_SAMPLE_RATE_HZ: usize = 12000;
const BT_SPEAKER_TEST_FREQUENCY_HZ: f32 = 880.0;
const BT_SPEAKER_TEST_AMPLITUDE: f32 = 0.35;

pub(crate) fn audio_settings_from_state(state: &ControllerState) -> AudioSettings {
    AudioSettings {
        speaker_volume: state.speaker_volume,
        headphone_volume: state.headphone_volume,
        mic_volume: state.mic_volume,
        mic_mute: state.mic_mute,
        audio_mute: state.audio_mute,
        mic_mute_led: state.mic_mute_led,
        force_internal_mic: state.force_internal_mic,
        force_internal_speaker: state.force_internal_speaker,
    }
}

pub(crate) fn apply_audio_settings(state: &mut ControllerState, settings: &AudioSettings) {
    state.speaker_volume = settings.speaker_volume.min(100);
    state.headphone_volume = settings.headphone_volume.min(100);
    state.mic_volume = settings.mic_volume.min(100);
    state.mic_mute = settings.mic_mute;
    state.audio_mute = settings.audio_mute;
    state.mic_mute_led = settings.mic_mute_led.min(2);
    state.force_internal_mic = settings.force_internal_mic;
    state.force_internal_speaker = settings.force_internal_speaker;
    state.output_dirty = true;
}

fn is_dualsense_audio_device_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("dualsense")
        || lower.contains("wireless controller")
        || lower.contains("controller speaker")
}

fn find_dualsense_output_device() -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    host.output_devices()
        .map_err(|e| format!("Failed to enumerate output devices: {e}"))?
        .find(|device| {
            device
                .name()
                .map(|name| is_dualsense_audio_device_name(&name))
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "No DualSense audio output was found. Make sure the controller audio device is available in Windows."
                .to_string()
        })
}

fn find_dualsense_input_device() -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {e}"))?
        .find(|device| {
            device
                .name()
                .map(|name| is_dualsense_audio_device_name(&name))
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "No DualSense microphone was found. Make sure the controller audio input is available in Windows."
                .to_string()
        })
}

fn build_speaker_test_stream_f32(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    frequency_hz: f32,
    amplitude: f32,
) -> Result<cpal::Stream, String> {
    let mut phase = 0.0f32;
    let channels = usize::from(config.channels.max(1));
    let sample_rate = config.sample_rate.0.max(1) as f32;
    let phase_step = (2.0 * std::f32::consts::PI * frequency_hz) / sample_rate;

    device
        .build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                for frame in data.chunks_mut(channels) {
                    let sample = phase.sin() * amplitude;
                    phase = (phase + phase_step) % (2.0 * std::f32::consts::TAU);
                    for slot in frame.iter_mut() {
                        *slot = sample;
                    }
                }
            },
            |err| eprintln!("Speaker output stream error: {err}"),
            None,
        )
        .map_err(|e| format!("Failed to build DualSense speaker stream: {e}"))
}

fn build_speaker_test_stream_i16(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    frequency_hz: f32,
    amplitude: f32,
) -> Result<cpal::Stream, String> {
    let mut phase = 0.0f32;
    let channels = usize::from(config.channels.max(1));
    let sample_rate = config.sample_rate.0.max(1) as f32;
    let phase_step = (2.0 * std::f32::consts::PI * frequency_hz) / sample_rate;

    device
        .build_output_stream(
            config,
            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                for frame in data.chunks_mut(channels) {
                    let sample = (phase.sin() * amplitude * i16::MAX as f32) as i16;
                    phase = (phase + phase_step) % (2.0 * std::f32::consts::TAU);
                    for slot in frame.iter_mut() {
                        *slot = sample;
                    }
                }
            },
            |err| eprintln!("Speaker output stream error: {err}"),
            None,
        )
        .map_err(|e| format!("Failed to build DualSense speaker stream: {e}"))
}

fn build_speaker_test_stream_u16(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    frequency_hz: f32,
    amplitude: f32,
) -> Result<cpal::Stream, String> {
    let mut phase = 0.0f32;
    let channels = usize::from(config.channels.max(1));
    let sample_rate = config.sample_rate.0.max(1) as f32;
    let phase_step = (2.0 * std::f32::consts::PI * frequency_hz) / sample_rate;

    device
        .build_output_stream(
            config,
            move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                for frame in data.chunks_mut(channels) {
                    let normalized = (phase.sin() * amplitude * 0.5) + 0.5;
                    let sample = (normalized * u16::MAX as f32) as u16;
                    phase = (phase + phase_step) % (2.0 * std::f32::consts::TAU);
                    for slot in frame.iter_mut() {
                        *slot = sample;
                    }
                }
            },
            |err| eprintln!("Speaker output stream error: {err}"),
            None,
        )
        .map_err(|e| format!("Failed to build DualSense speaker stream: {e}"))
}

fn build_bluetooth_speaker_test_buffer() -> Vec<u8> {
    let sample_count = (BT_SPEAKER_TEST_SAMPLE_RATE_HZ * BT_SPEAKER_TEST_DURATION_MS) / 1000;
    let mut pcm = Vec::with_capacity(sample_count * 2);
    let phase_step = (2.0 * std::f32::consts::PI * BT_SPEAKER_TEST_FREQUENCY_HZ)
        / BT_SPEAKER_TEST_SAMPLE_RATE_HZ as f32;
    let mut phase = 0.0f32;

    for _ in 0..sample_count {
        let sample = (phase.sin() * BT_SPEAKER_TEST_AMPLITUDE * i16::MAX as f32) as i16;
        pcm.extend_from_slice(&sample.to_le_bytes());
        phase = (phase + phase_step) % std::f32::consts::TAU;
    }

    pcm
}

fn begin_speaker_test(
    state: &Arc<Mutex<ControllerState>>,
    previous_audio: AudioSettings,
    audio_buf: Vec<u8>,
) -> Result<(), String> {
    let mut s = lock_state(state);
    if !s.connected {
        return Err("Connect a DualSense controller first.".to_string());
    }
    if s.speaker_test_active {
        return Err("A speaker test is already running.".to_string());
    }

    s.speaker_test_active = true;
    s.speaker_test_restore_audio = Some(previous_audio);
    s.pending_speaker_restore = false;
    s.audio_buf = audio_buf;
    s.audio_buf_offset = 0;
    s.last_audio_write_at = None;
    s.speaker_volume = s.speaker_volume.max(95);
    s.audio_mute = false;
    s.force_internal_speaker = true;
    s.output_dirty = true;

    Ok(())
}

fn finish_speaker_test(state: &Arc<Mutex<ControllerState>>) {
    let mut current = lock_state(state);
    if let Some(previous_audio) = current.speaker_test_restore_audio.take() {
        apply_audio_settings(&mut current, &previous_audio);
    }
    current.speaker_test_active = false;
    current.pending_speaker_restore = false;
    current.audio_buf.clear();
    current.audio_buf_offset = 0;
    current.last_audio_write_at = None;
    current.output_dirty = current.connected;
}

pub(crate) fn complete_pending_speaker_restore(state: &mut ControllerState) -> bool {
    if !state.pending_speaker_restore {
        return false;
    }

    state.pending_speaker_restore = false;
    if let Some(previous_audio) = state.speaker_test_restore_audio.take() {
        apply_audio_settings(state, &previous_audio);
    }
    state.speaker_test_active = false;
    state.audio_buf.clear();
    state.audio_buf_offset = 0;
    state.last_audio_write_at = None;
    state.output_dirty = state.connected;
    true
}

fn run_bluetooth_mic_probe(state: &Arc<Mutex<ControllerState>>) -> String {
    let previous_audio = {
        let mut s = lock_state(state);
        if !s.connected || s.connection_transport != ConnectionTransport::Bluetooth {
            return "Bluetooth mic probe skipped.".to_string();
        }

        let previous_audio = audio_settings_from_state(&s);
        s.bt_mic_probe_active = true;
        s.bt_mic_probe_observations.clear();
        s.mic_mute = false;
        s.force_internal_mic = true;
        s.output_dirty = true;
        previous_audio
    };

    thread::sleep(Duration::from_millis(900));

    let mut s = lock_state(state);
    s.bt_mic_probe_active = false;
    let observations = if s.bt_mic_probe_observations.is_empty() {
        "no Bluetooth HID reports were observed during the probe window".to_string()
    } else {
        format!(
            "observed HID reports {} during the probe window",
            s.bt_mic_probe_observations.join(", ")
        )
    };
    apply_audio_settings(&mut s, &previous_audio);
    s.bt_mic_probe_observations.clear();
    observations
}

pub(crate) fn get_audio(state: Arc<Mutex<ControllerState>>) -> AudioSettings {
    let s = lock_state(&state);
    audio_settings_from_state(&s)
}

pub(crate) fn set_audio(
    state: Arc<Mutex<ControllerState>>,
    speaker_volume: u8,
    headphone_volume: u8,
    mic_volume: u8,
    mic_mute: bool,
    audio_mute: bool,
    mic_mute_led: u8,
    force_internal_mic: bool,
    force_internal_speaker: bool,
) {
    let mut s = lock_state(&state);
    apply_audio_settings(
        &mut s,
        &AudioSettings {
            speaker_volume,
            headphone_volume,
            mic_volume,
            mic_mute,
            audio_mute,
            mic_mute_led,
            force_internal_mic,
            force_internal_speaker,
        },
    );
}

pub(crate) fn test_speaker(state: Arc<Mutex<ControllerState>>) -> Result<(), String> {
    let (previous_audio, transport) = {
        let s = lock_state(&state);
        if !s.connected {
            return Err("Connect a DualSense controller first.".to_string());
        }
        if s.speaker_test_active {
            return Err("A speaker test is already running.".to_string());
        }
        if s.connection_transport == ConnectionTransport::Unknown {
            return Err(
                "The connection type is still being detected. Try again in a moment.".to_string(),
            );
        }
        (audio_settings_from_state(&s), s.connection_transport)
    };

    if transport == ConnectionTransport::Bluetooth {
        begin_speaker_test(
            &state,
            previous_audio,
            build_bluetooth_speaker_test_buffer(),
        )?;
        return Ok(());
    }

    let output_device = find_dualsense_output_device()?;
    let supported_config = output_device
        .default_output_config()
        .map_err(|e| format!("Failed to read the DualSense output format: {e}"))?;
    let stream_config = supported_config.config();
    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => {
            build_speaker_test_stream_f32(&output_device, &stream_config, 880.0, 0.42)?
        }
        cpal::SampleFormat::I16 => {
            build_speaker_test_stream_i16(&output_device, &stream_config, 880.0, 0.42)?
        }
        cpal::SampleFormat::U16 => {
            build_speaker_test_stream_u16(&output_device, &stream_config, 880.0, 0.42)?
        }
        other => {
            return Err(format!(
                "Unsupported DualSense output sample format: {other:?}"
            ));
        }
    };

    if {
        let s = lock_state(&state);
        !s.connected || s.connection_transport != ConnectionTransport::Usb
    } {
        return Err(
            "Reconnect the controller over USB, then try the speaker test again.".to_string(),
        );
    }

    begin_speaker_test(&state, previous_audio.clone(), Vec::new())?;

    if let Err(err) = stream.play() {
        finish_speaker_test(&state);
        return Err(format!(
            "Failed to start the DualSense speaker stream: {err}"
        ));
    }

    thread::sleep(Duration::from_millis(1600));
    drop(stream);
    finish_speaker_test(&state);

    Ok(())
}

pub(crate) fn get_audio_test_status(state: Arc<Mutex<ControllerState>>) -> (bool, bool) {
    let s = lock_state(&state);
    (s.speaker_test_active, s.mic_test_active)
}

pub(crate) fn start_mic_test(state: Arc<Mutex<ControllerState>>) -> Result<(), String> {
    let transport = {
        let s = lock_state(&state);
        if !s.connected {
            return Err("Connect a DualSense controller first.".to_string());
        }
        if s.mic_test_active {
            return Ok(());
        }
        s.connection_transport
    };

    let probe_summary = if transport == ConnectionTransport::Bluetooth {
        Some(run_bluetooth_mic_probe(&state))
    } else {
        None
    };

    let host = cpal::default_host();

    let input_device = find_dualsense_input_device().map_err(|err| {
        if let Some(summary) = &probe_summary {
            format!("{err} Bluetooth probe summary: {summary}.")
        } else {
            err
        }
    })?;

    let output_device = host
        .default_output_device()
        .ok_or_else(|| "No default audio output device found.".to_string())?;

    let input_config = input_device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {e}"))?;

    let sample_rate = input_config.sample_rate();
    let channels = input_config.channels();

    let output_config = cpal::StreamConfig {
        channels,
        sample_rate,
        buffer_size: cpal::BufferSize::Default,
    };

    let ring = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(
        sample_rate.0 as usize,
    )));
    let ring_tx = ring.clone();
    let ring_rx = ring;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_thread = stop_flag.clone();

    {
        let mut s = lock_state(&state);
        s.mic_test_active = true;
        s.mic_test_stop = Some(stop_flag.clone());
    }

    let state_for_thread = state.clone();

    thread::spawn(move || {
        let input_stream = input_device
            .build_input_stream(
                &input_config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut buf) = ring_tx.lock() {
                        buf.extend(data.iter());
                        const MAX_BUFFERED: usize = 48000;
                        while buf.len() > MAX_BUFFERED {
                            buf.pop_front();
                        }
                    }
                },
                |err| eprintln!("Mic input stream error: {err}"),
                None,
            )
            .ok();

        let output_stream = output_device
            .build_output_stream(
                &output_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    if let Ok(mut buf) = ring_rx.lock() {
                        for sample in data.iter_mut() {
                            *sample = buf.pop_front().unwrap_or(0.0);
                        }
                    }
                },
                |err| eprintln!("Mic output stream error: {err}"),
                None,
            )
            .ok();

        if let Some(ref s) = input_stream {
            let _ = s.play();
        }
        if let Some(ref s) = output_stream {
            let _ = s.play();
        }

        while !stop_flag_thread.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(50));
        }

        drop(input_stream);
        drop(output_stream);

        let mut s = lock_state(&state_for_thread);
        s.mic_test_active = false;
        s.mic_test_stop = None;
    });

    Ok(())
}

pub(crate) fn stop_mic_test(state: Arc<Mutex<ControllerState>>) {
    let s = lock_state(&state);
    if let Some(ref flag) = s.mic_test_stop {
        flag.store(true, Ordering::Relaxed);
    }
}
