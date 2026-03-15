use crc32fast::Hasher;

use super::{
    ConnectionTransport, ControllerState, TriggerEffectConfig, TriggerEffectKind,
    AUDIO_PAYLOAD_MAX_PER_REPORT, AUDIO_PAYLOAD_OFFSET, AUDIO_PAYLOAD_STEP,
    AUDIO_REPORT_BT_EXT_BASE, AUDIO_REPORT_BT_EXT_MAX, BT_OUTPUT_CRC_SEED, BT_OUTPUT_REPORT_LEN,
    DS_OUTPUT_REPORT_BT, DS_OUTPUT_REPORT_USB, DS_OUTPUT_TAG, USB_INPUT_REPORT_LEN,
};

pub(crate) fn crc32_with_seed(seed: u8, data: &[u8]) -> u32 {
    let mut hasher = Hasher::new();
    hasher.update(&[seed]);
    hasher.update(data);
    hasher.finalize()
}

pub(crate) fn default_trigger_effect() -> TriggerEffectConfig {
    TriggerEffectConfig {
        kind: TriggerEffectKind::Off,
        start_position: Some(0),
        end_position: Some(180),
        force: Some(0),
        frequency: Some(30),
        raw_mode: Some(0),
        raw_params: Some(vec![0; 10]),
    }
}

pub(crate) fn normalize_trigger_effect(effect: &TriggerEffectConfig) -> TriggerEffectConfig {
    let raw_params = (0..10)
        .map(|index| {
            effect
                .raw_params
                .as_ref()
                .and_then(|params| params.get(index))
                .copied()
                .unwrap_or(0)
        })
        .collect::<Vec<_>>();
    TriggerEffectConfig {
        kind: effect.kind,
        start_position: Some(effect.start_position.unwrap_or(0)),
        end_position: Some(effect.end_position.unwrap_or(180)),
        force: Some(effect.force.unwrap_or(0)),
        frequency: Some(effect.frequency.unwrap_or(30)),
        raw_mode: Some(effect.raw_mode.unwrap_or(0)),
        raw_params: Some(raw_params),
    }
}

fn encode_trigger_effect(
    common: &mut [u8],
    effect: &TriggerEffectConfig,
    mode_index: usize,
    data_index: usize,
) {
    let normalized = normalize_trigger_effect(effect);
    let mode = match normalized.kind {
        TriggerEffectKind::Off => 0,
        TriggerEffectKind::ContinuousResistance => 1,
        TriggerEffectKind::SectionResistance => 2,
        TriggerEffectKind::Vibration => 6,
        TriggerEffectKind::MachineGun => 0x27,
        TriggerEffectKind::Raw => normalized.raw_mode.unwrap_or(0),
    };
    common[mode_index] = mode;

    match normalized.kind {
        TriggerEffectKind::Off => {}
        TriggerEffectKind::ContinuousResistance => {
            common[data_index] = normalized.start_position.unwrap_or(0);
            common[data_index + 1] = normalized.force.unwrap_or(0);
        }
        TriggerEffectKind::SectionResistance => {
            common[data_index] = normalized.start_position.unwrap_or(0);
            common[data_index + 1] = normalized.end_position.unwrap_or(180);
            common[data_index + 2] = normalized.force.unwrap_or(0);
        }
        TriggerEffectKind::Vibration => {
            common[data_index] = normalized.frequency.unwrap_or(30);
            common[data_index + 1] = (normalized.force.unwrap_or(0) as u16 * 63 / 255) as u8;
            common[data_index + 2] = normalized.start_position.unwrap_or(0);
        }
        TriggerEffectKind::MachineGun => {
            common[data_index] = 0xFF;
            common[data_index + 1] = 0xFF;
            let force = normalized.force.unwrap_or(0);
            common[data_index + 2] = (force >> 5) | ((force >> 5) << 3);
            common[data_index + 3] = normalized.frequency.unwrap_or(30);
            common[data_index + 4] = 5;
        }
        TriggerEffectKind::Raw => {
            for (index, byte) in normalized
                .raw_params
                .unwrap_or_default()
                .iter()
                .enumerate()
                .take(10)
            {
                common[data_index + index] = *byte;
            }
        }
    }
}

fn fill_output_report_common(state: &ControllerState, common: &mut [u8]) {
    common[0] = 0xFF;
    common[1] = 0x1 | 0x2 | 0x4 | 0x10 | 0x40;

    common[2] = state.rumble_right;
    common[3] = state.rumble_left;

    common[4] = if state.headphone_volume == 0 {
        0
    } else {
        (30 + (state.headphone_volume as u16 * 97 / 100)).min(127) as u8
    };
    common[5] = if state.speaker_volume == 0 {
        0
    } else {
        (61 + (state.speaker_volume as u16 * 39 / 100)).min(100) as u8
    };
    common[6] = ((state.mic_volume as u16 * 64 / 100) as u8).min(64);
    common[7] = if state.force_internal_mic { 0x01 } else { 0 }
        | if state.force_internal_speaker {
            0x20
        } else {
            0
        };
    common[8] = state.mic_mute_led;
    common[9] = if state.mic_mute { 0x10 } else { 0 } | if state.audio_mute { 0x40 } else { 0 };

    encode_trigger_effect(common, &state.right_trigger, 10, 11);
    encode_trigger_effect(common, &state.left_trigger, 21, 22);

    common[38] = 2;
    common[41] = 2;
    common[42] = 0x02;
    common[43] = 0x04;
    common[44] = state.r;
    common[45] = state.g;
    common[46] = state.b;
}

pub(crate) fn build_output_report(state: &mut ControllerState) -> Vec<u8> {
    match state.connection_transport {
        ConnectionTransport::Bluetooth => {
            let has_audio =
                state.speaker_test_active && state.audio_buf_offset < state.audio_buf.len();

            let (report_id, report_len, audio_chunk) = if has_audio {
                let remaining = state.audio_buf.len() - state.audio_buf_offset;
                let chunk = remaining.min(AUDIO_PAYLOAD_MAX_PER_REPORT);
                let payload_bucket =
                    ((chunk + AUDIO_PAYLOAD_STEP - 1) / AUDIO_PAYLOAD_STEP) * AUDIO_PAYLOAD_STEP;
                let report_id = (AUDIO_REPORT_BT_EXT_BASE
                    + ((payload_bucket / AUDIO_PAYLOAD_STEP) as u8).saturating_sub(1))
                .min(AUDIO_REPORT_BT_EXT_MAX);
                (report_id, BT_OUTPUT_REPORT_LEN + payload_bucket, chunk)
            } else {
                (DS_OUTPUT_REPORT_BT, BT_OUTPUT_REPORT_LEN, 0)
            };

            let mut report = vec![0u8; report_len];
            report[0] = report_id;
            report[1] = state.bt_output_seq << 4;
            report[2] = DS_OUTPUT_TAG;
            fill_output_report_common(state, &mut report[3..50]);

            if has_audio {
                let src_end = state.audio_buf_offset + audio_chunk;
                report[AUDIO_PAYLOAD_OFFSET..AUDIO_PAYLOAD_OFFSET + audio_chunk]
                    .copy_from_slice(&state.audio_buf[state.audio_buf_offset..src_end]);
                state.audio_buf_offset += audio_chunk;

                if state.audio_buf_offset >= state.audio_buf.len() {
                    state.speaker_test_active = false;
                    state.audio_buf.clear();
                    state.audio_buf_offset = 0;
                    state.pending_speaker_restore = true;
                }
            }

            let crc = crc32_with_seed(BT_OUTPUT_CRC_SEED, &report[..report_len - 4]);
            report[report_len - 4..].copy_from_slice(&crc.to_le_bytes());

            state.bt_output_seq = (state.bt_output_seq + 1) & 0x0F;
            report
        }
        _ => {
            let mut report = vec![0u8; USB_INPUT_REPORT_LEN];
            report[0] = DS_OUTPUT_REPORT_USB;
            fill_output_report_common(state, &mut report[1..48]);
            report
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_trigger_effect_pads_missing_raw_payload() {
        let effect = TriggerEffectConfig {
            kind: TriggerEffectKind::Raw,
            start_position: None,
            end_position: None,
            force: None,
            frequency: None,
            raw_mode: Some(35),
            raw_params: Some(vec![1, 2, 3]),
        };

        let normalized = normalize_trigger_effect(&effect);
        assert_eq!(normalized.raw_mode, Some(35));
        assert_eq!(normalized.raw_params.as_ref().map(Vec::len), Some(10));
        assert_eq!(normalized.raw_params.expect("raw params")[0..3], [1, 2, 3]);
    }

    #[test]
    fn encode_machine_gun_effect_sets_expected_bytes() {
        let mut common = [0u8; 48];
        let effect = TriggerEffectConfig {
            kind: TriggerEffectKind::MachineGun,
            start_position: None,
            end_position: None,
            force: Some(224),
            frequency: Some(33),
            raw_mode: None,
            raw_params: None,
        };

        encode_trigger_effect(&mut common, &effect, 10, 11);

        assert_eq!(common[10], 0x27);
        assert_eq!(common[11], 0xFF);
        assert_eq!(common[12], 0xFF);
        assert_eq!(common[14], 33);
        assert_eq!(common[15], 5);
    }
}
