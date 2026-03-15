import {
  Activity,
  CircleDotDashed,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import {
  DEFAULT_CALIBRATION_PROFILE,
  type CalibrationCapabilities,
  type CalibrationProfile,
  type ConnectionTransport,
  type FirmwareCalibrationStatus,
  type LiveInputSnapshot,
  type StickSnapshot,
  type TriggerSnapshot,
} from "../../mapping";

type FirmwareCommand =
  | "start_firmware_center_calibration"
  | "start_firmware_range_calibration"
  | "sample_firmware_center_calibration"
  | "store_firmware_center_calibration"
  | "store_firmware_range_calibration"
  | "save_firmware_calibration_permanently"
  | "cancel_firmware_calibration";

type StickSide = "leftStick" | "rightStick";
type TriggerSide = "leftTrigger" | "rightTrigger";

type StepTone = "neutral" | "active" | "complete" | "warning";

export interface FirmwareWizardStep {
  id: string;
  title: string;
  detail: string;
  tone: StepTone;
}

export interface StickReadiness {
  canCaptureCenter: boolean;
  statusLabel: string;
  statusToneClass: string;
  helperText: string;
}

export function getTransportLabel(transport: ConnectionTransport) {
  if (transport === "bluetooth") return "Bluetooth";
  if (transport === "usb") return "USB";
  return "Detecting";
}

export function formatFirmwareStep(step: FirmwareCalibrationStatus["step"]) {
  switch (step) {
    case "idle":
      return "Idle";
    case "centerSampling":
      return "Center Sampling";
    case "centerSampled":
      return "Center Ready";
    case "rangeSampling":
      return "Range Sampling";
    case "completedTemporary":
      return "Temporary Saved";
    case "completedPermanent":
      return "Permanent Saved";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Error";
  }
}

export function getStickReadiness(snapshot: StickSnapshot): StickReadiness {
  const rawMagnitude = Math.hypot(snapshot.normalizedX, snapshot.normalizedY);
  const calibratedMagnitude = Math.hypot(snapshot.calibratedX, snapshot.calibratedY);
  const strongest = Math.max(rawMagnitude, calibratedMagnitude);

  if (strongest <= 0.08) {
    return {
      canCaptureCenter: true,
      statusLabel: "Resting now",
      statusToneClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      helperText: "Stick looks settled. Capturing center now is usually safe.",
    };
  }

  if (strongest >= 0.95) {
    return {
      canCaptureCenter: false,
      statusLabel: "Near edge",
      statusToneClass: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      helperText: "The stick is close to its edge. Let it return to rest before saving center.",
    };
  }

  return {
    canCaptureCenter: false,
    statusLabel: "Moving",
    statusToneClass: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    helperText: "Wait for the stick to settle near the middle, then save center.",
  };
}

export function buildFirmwareWizardSteps(
  status: FirmwareCalibrationStatus,
  riskAccepted: boolean,
): FirmwareWizardStep[] {
  const selectModeTone: StepTone = status.activeMode || status.lastCompletedMode ? "complete" : "neutral";
  const followInstructionsTone: StepTone = status.busy ? "active" : status.lastCompletedMode ? "complete" : "neutral";
  const testTone: StepTone = status.step === "completedTemporary" ? "active" : status.step === "completedPermanent" ? "complete" : "neutral";
  const permanentTone: StepTone =
    status.step === "completedPermanent"
      ? "complete"
      : riskAccepted && status.canStorePermanently
        ? "active"
        : "warning";

  return [
    {
      id: "connect",
      title: "Connect over USB",
      detail: status.eligible
        ? "Controller is ready for firmware commands."
        : status.connected
          ? "Reconnect over USB. Bluetooth firmware calibration is blocked."
          : "Connect a DualSense by USB before starting.",
      tone: status.eligible ? "complete" : "warning",
    },
    {
      id: "mode",
      title: "Choose center or range",
      detail: status.activeMode
        ? `Current mode: ${status.activeMode === "center" ? "Center calibration" : "Range calibration"}.`
        : "Center fixes rest drift. Range is for full-circle stick travel after repair.",
      tone: selectModeTone,
    },
    {
      id: "follow",
      title: "Follow the guided step",
      detail: status.lastMessage,
      tone: followInstructionsTone,
    },
    {
      id: "test",
      title: "Test the temporary result",
      detail:
        status.step === "completedTemporary"
          ? "Use the live preview below before deciding on a permanent write."
          : "Temporary saves are safer and should be tested before writing permanently.",
      tone: testTone,
    },
    {
      id: "permanent",
      title: "Optional permanent write",
      detail: riskAccepted
        ? "Risk acknowledgement enabled. Permanent save stays available only when the backend says it is safe."
        : "Permanent writes stay locked until you acknowledge the risk.",
      tone: permanentTone,
    },
  ];
}

export function CalibrationPanel({
  calibrationProfile,
  liveInput,
  calibrationCapabilities,
  firmwareStatus,
  firmwareRiskAccepted,
  onFirmwareRiskAcceptedChange,
  onResetCalibration,
  onSetStickCenterFromCurrent,
  onResetStick,
  onUpdateStick,
  onResetTrigger,
  onUpdateTrigger,
  onRunFirmwareCommand,
}: {
  calibrationProfile: CalibrationProfile;
  liveInput: LiveInputSnapshot;
  calibrationCapabilities: CalibrationCapabilities | null;
  firmwareStatus: FirmwareCalibrationStatus;
  firmwareRiskAccepted: boolean;
  onFirmwareRiskAcceptedChange: (value: boolean) => void;
  onResetCalibration: () => void;
  onSetStickCenterFromCurrent: (side: StickSide) => void;
  onResetStick: (side: StickSide) => void;
  onUpdateStick: (side: StickSide, next: CalibrationProfile["leftStick"]) => void;
  onResetTrigger: (side: TriggerSide) => void;
  onUpdateTrigger: (side: TriggerSide, next: CalibrationProfile["leftTrigger"]) => void;
  onRunFirmwareCommand: (command: FirmwareCommand) => void;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-4xl font-bold mb-2">Calibration</h2>
          <p className="text-white/50 max-w-3xl">
            Use software calibration to mask light drift in the app. Use firmware calibration only over USB after a
            repair or stick replacement.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onResetCalibration} className="glass-button px-5 py-2.5 rounded-xl font-medium text-white/80">
            Reset All Calibration
          </button>
        </div>
      </div>

      <CalibrationOverviewCard
        transport={firmwareStatus.transport}
        note={calibrationCapabilities?.firmwareCalibrationNote ?? "Firmware calibration uses undocumented DualSense commands and should be treated as an advanced repair workflow."}
      />

      <FirmwareCalibrationPanel
        status={firmwareStatus}
        riskAccepted={firmwareRiskAccepted}
        onRiskAcceptedChange={onFirmwareRiskAcceptedChange}
        onRunFirmwareCommand={onRunFirmwareCommand}
      />

      <SoftwareCalibrationPanel
        calibrationProfile={calibrationProfile}
        liveInput={liveInput}
        onSetStickCenterFromCurrent={onSetStickCenterFromCurrent}
        onResetStick={onResetStick}
        onUpdateStick={onUpdateStick}
        onResetTrigger={onResetTrigger}
        onUpdateTrigger={onUpdateTrigger}
      />

      <LiveInputPanel liveInput={liveInput} />
    </div>
  );
}

function CalibrationOverviewCard({
  transport,
  note,
}: {
  transport: ConnectionTransport;
  note: string;
}) {
  return (
    <div className="glass-panel p-6 rounded-3xl mb-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-black/20 rounded-2xl border border-white/5 p-5">
          <div className="flex items-center gap-3 mb-3">
            <CircleDotDashed className="w-5 h-5 text-blue-300" />
            <h3 className="text-lg font-semibold">Start Here</h3>
          </div>
          <p className="text-sm text-white/55 leading-relaxed">
            If the controller only drifts a little at rest, adjust software deadzone and center. This applies
            instantly and saves locally on this PC.
          </p>
        </div>

        <div className="bg-black/20 rounded-2xl border border-white/5 p-5">
          <div className="flex items-center gap-3 mb-3">
            <Wrench className="w-5 h-5 text-amber-300" />
            <h3 className="text-lg font-semibold">Firmware Calibration</h3>
          </div>
          <p className="text-sm text-white/55 leading-relaxed">
            Use this only after hardware repair or replacement. Current transport:{" "}
            <span className="font-medium text-white/80">{getTransportLabel(transport)}</span>.
          </p>
        </div>

        <div className="bg-black/20 rounded-2xl border border-white/5 p-5">
          <div className="flex items-center gap-3 mb-3">
            <ShieldAlert className="w-5 h-5 text-red-300" />
            <h3 className="text-lg font-semibold">Safety Note</h3>
          </div>
          <p className="text-sm text-white/55 leading-relaxed">{note}</p>
        </div>
      </div>
    </div>
  );
}

function FirmwareCalibrationPanel({
  status,
  riskAccepted,
  onRiskAcceptedChange,
  onRunFirmwareCommand,
}: {
  status: FirmwareCalibrationStatus;
  riskAccepted: boolean;
  onRiskAcceptedChange: (value: boolean) => void;
  onRunFirmwareCommand: (command: FirmwareCommand) => void;
}) {
  const wizardSteps = buildFirmwareWizardSteps(status, riskAccepted);
  const storeTemporaryCommand =
    status.activeMode === "center" ? "store_firmware_center_calibration" : "store_firmware_range_calibration";
  const startDisabled = !status.eligible || status.busy;

  return (
    <div className="glass-panel p-6 rounded-3xl mb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <ShieldAlert className="w-5 h-5 text-amber-300" />
            <div className="text-sm font-medium text-white/80">Firmware-Level Calibration</div>
          </div>
          <p className="text-sm text-white/50 leading-relaxed mb-4">
            This flow follows the same center and range commands used by known DualSense repair tools. Prefer a
            temporary save first, then test before writing permanently.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-4">
            <StatusCard label="Transport" value={getTransportLabel(status.transport)} />
            <StatusCard label="Status" value={formatFirmwareStep(status.step)} />
            <StatusCard label="Last Mode" value={status.lastCompletedMode ? formatMode(status.lastCompletedMode) : "None"} />
          </div>

          <div className="space-y-3">
            {wizardSteps.map((step, index) => (
              <div key={step.id} className="flex gap-3 rounded-2xl border border-white/5 bg-black/20 p-4">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${stepToneClass(step.tone)}`}>
                  {index + 1}
                </div>
                <div>
                  <div className="text-sm font-medium text-white/85">{step.title}</div>
                  <p className="text-sm text-white/50 mt-1 leading-relaxed">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:max-w-md w-full">
          <div className="bg-black/20 rounded-2xl border border-white/5 p-4 mb-4">
            <div className="text-sm text-white/80 mb-2">Current instruction</div>
            <p className="text-sm text-white/50 leading-relaxed">{status.lastMessage}</p>
            {status.lastError && (
              <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
                <div className="font-medium mb-1">Technical error</div>
                <div>{status.lastError}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              disabled={startDisabled}
              onClick={() => onRunFirmwareCommand("start_firmware_center_calibration")}
              className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start Center Calibration
            </button>
            <button
              disabled={startDisabled}
              onClick={() => onRunFirmwareCommand("start_firmware_range_calibration")}
              className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start Range Calibration
            </button>
            <button
              disabled={!status.canSampleCenter}
              onClick={() => onRunFirmwareCommand("sample_firmware_center_calibration")}
              className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Sample Center
            </button>
            <button
              disabled={!status.canStoreTemporarily}
              onClick={() => onRunFirmwareCommand(storeTemporaryCommand)}
              className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Store Temporary
            </button>
          </div>

          <label className="flex items-start gap-3 text-sm text-white/55 mb-4">
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(event) => onRiskAcceptedChange(event.target.checked)}
              className="mt-1"
            />
            <span>
              I understand permanent firmware calibration writes directly to the controller and may fail on unsupported
              firmware or hardware.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <button
              disabled={!status.canStorePermanently || !riskAccepted}
              onClick={() => onRunFirmwareCommand("save_firmware_calibration_permanently")}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-xl text-sm font-medium transition-colors"
            >
              Save Permanently
            </button>
            <button
              disabled={!status.busy}
              onClick={() => onRunFirmwareCommand("cancel_firmware_calibration")}
              className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel Session
            </button>
          </div>

          <div className="rounded-2xl border border-white/5 bg-black/15 p-4 text-sm text-white/50">
            {status.requiresStickRotation
              ? "Range calibration is active. Rotate both sticks through their full circular travel before storing."
              : "Center calibration works best while both sticks are untouched and resting naturally."}
          </div>
        </div>
      </div>
    </div>
  );
}

function SoftwareCalibrationPanel({
  calibrationProfile,
  liveInput,
  onSetStickCenterFromCurrent,
  onResetStick,
  onUpdateStick,
  onResetTrigger,
  onUpdateTrigger,
}: {
  calibrationProfile: CalibrationProfile;
  liveInput: LiveInputSnapshot;
  onSetStickCenterFromCurrent: (side: StickSide) => void;
  onResetStick: (side: StickSide) => void;
  onUpdateStick: (side: StickSide, next: CalibrationProfile["leftStick"]) => void;
  onResetTrigger: (side: TriggerSide) => void;
  onUpdateTrigger: (side: TriggerSide, next: CalibrationProfile["leftTrigger"]) => void;
}) {
  return (
    <>
      <div className="glass-panel p-6 rounded-3xl mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Activity className="w-5 h-5 text-blue-300" />
          <h3 className="text-lg font-semibold">Software Calibration</h3>
        </div>
        <p className="text-sm text-white/50 max-w-3xl">
          Changes apply immediately and are saved locally. Start with the smallest deadzone that removes unwanted drift,
          then adjust center only while the stick is resting.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <CalibrationStickCard
          title="Left Stick"
          snapshot={liveInput.leftStick}
          calibration={calibrationProfile.leftStick}
          defaults={DEFAULT_CALIBRATION_PROFILE.leftStick}
          onCenterFromCurrent={() => onSetStickCenterFromCurrent("leftStick")}
          onReset={() => onResetStick("leftStick")}
          onChange={(nextStick) => onUpdateStick("leftStick", nextStick)}
        />
        <CalibrationStickCard
          title="Right Stick"
          snapshot={liveInput.rightStick}
          calibration={calibrationProfile.rightStick}
          defaults={DEFAULT_CALIBRATION_PROFILE.rightStick}
          onCenterFromCurrent={() => onSetStickCenterFromCurrent("rightStick")}
          onReset={() => onResetStick("rightStick")}
          onChange={(nextStick) => onUpdateStick("rightStick", nextStick)}
        />
        <CalibrationTriggerCard
          title="Left Trigger"
          snapshot={liveInput.leftTrigger}
          calibration={calibrationProfile.leftTrigger}
          defaults={DEFAULT_CALIBRATION_PROFILE.leftTrigger}
          onReset={() => onResetTrigger("leftTrigger")}
          onChange={(nextTrigger) => onUpdateTrigger("leftTrigger", nextTrigger)}
        />
        <CalibrationTriggerCard
          title="Right Trigger"
          snapshot={liveInput.rightTrigger}
          calibration={calibrationProfile.rightTrigger}
          defaults={DEFAULT_CALIBRATION_PROFILE.rightTrigger}
          onReset={() => onResetTrigger("rightTrigger")}
          onChange={(nextTrigger) => onUpdateTrigger("rightTrigger", nextTrigger)}
        />
      </div>
    </>
  );
}

function LiveInputPanel({ liveInput }: { liveInput: LiveInputSnapshot }) {
  const stickSummaries = [
    { label: "Left Stick", snapshot: liveInput.leftStick },
    { label: "Right Stick", snapshot: liveInput.rightStick },
  ].map(({ label, snapshot }) => ({
    label,
    state: getStickReadiness(snapshot),
    rawMagnitude: Math.hypot(snapshot.normalizedX, snapshot.normalizedY),
  }));

  const triggerSummaries = [
    { label: "L2", snapshot: liveInput.leftTrigger },
    { label: "R2", snapshot: liveInput.rightTrigger },
  ];

  return (
    <div className="glass-panel p-6 rounded-3xl">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
        <div>
          <h3 className="text-lg font-semibold mb-1">Live Input Diagnostics</h3>
          <p className="text-white/45 text-sm">
            Use these readouts to confirm a stick is truly resting before capturing center or testing a firmware change.
          </p>
        </div>
        <div className="text-sm text-white/35">
          Pressed buttons: {liveInput.pressedButtons.length > 0 ? liveInput.pressedButtons.join(", ") : "None"}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {stickSummaries.map(({ label, state, rawMagnitude }) => (
          <div key={label} className="rounded-2xl border border-white/5 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="font-medium">{label}</div>
              <span className={`rounded-full border px-2.5 py-1 text-xs ${state.statusToneClass}`}>{state.statusLabel}</span>
            </div>
            <div className="space-y-1 text-sm text-white/50">
              <div>Raw movement magnitude: <span className="font-mono text-white/75">{rawMagnitude.toFixed(3)}</span></div>
              <div>{state.helperText}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {triggerSummaries.map(({ label, snapshot }) => (
          <div key={label} className="rounded-2xl border border-white/5 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="font-medium">{label}</div>
              <span className="text-xs text-white/45">Raw {snapshot.rawValue}</span>
            </div>
            <p className="text-sm text-white/50">
              Current pull: <span className="font-mono text-white/75">{snapshot.calibratedNormalized.toFixed(3)}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalibrationStickCard({
  title,
  snapshot,
  calibration,
  defaults,
  onCenterFromCurrent,
  onReset,
  onChange,
}: {
  title: string;
  snapshot: StickSnapshot;
  calibration: CalibrationProfile["leftStick"];
  defaults: CalibrationProfile["leftStick"];
  onCenterFromCurrent: () => void;
  onReset: () => void;
  onChange: (next: CalibrationProfile["leftStick"]) => void;
}) {
  const readiness = getStickReadiness(snapshot);

  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">Capture a rest center first, then raise deadzone only as much as needed.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onReset} className="glass-button px-4 py-2 rounded-xl text-sm font-medium">
            <span className="inline-flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Reset Stick
            </span>
          </button>
          <button
            onClick={onCenterFromCurrent}
            disabled={!readiness.canCaptureCenter}
            className="glass-button px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set Current as Center
          </button>
        </div>
      </div>

      <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${readiness.statusToneClass}`}>
        {readiness.helperText}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <StickVisualizer label="Raw" x={snapshot.normalizedX} y={snapshot.normalizedY} />
        <StickVisualizer label="Calibrated" x={snapshot.calibratedX} y={snapshot.calibratedY} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">Live Readout</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/50">Raw X</span><span className="font-mono">{snapshot.normalizedX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Raw Y</span><span className="font-mono">{snapshot.normalizedY.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Calibrated X</span><span className="font-mono">{snapshot.calibratedX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Calibrated Y</span><span className="font-mono">{snapshot.calibratedY.toFixed(3)}</span></div>
          </div>
        </div>
        <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">Tuning Summary</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/50">Center X</span><span className="font-mono">{calibration.centerX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Center Y</span><span className="font-mono">{calibration.centerY.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Deadzone</span><span className="font-mono">{calibration.deadzone.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Outer Scale</span><span className="font-mono">{calibration.outerScale.toFixed(2)}x</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RangeField
          label="Center X Offset"
          description="Shift the resting X center if the stick leans left or right."
          value={calibration.centerX}
          min={-0.5}
          max={0.5}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          onChange={(value) => onChange({ ...calibration, centerX: value })}
        />
        <RangeField
          label="Center Y Offset"
          description="Shift the resting Y center if the stick sits high or low."
          value={calibration.centerY}
          min={-0.5}
          max={0.5}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          onChange={(value) => onChange({ ...calibration, centerY: value })}
        />
        <RangeField
          label="Deadzone"
          description="Ignore tiny movement near rest to hide light drift."
          value={calibration.deadzone}
          min={0}
          max={0.35}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          defaultValue={defaults.deadzone}
          onChange={(value) => onChange({ ...calibration, deadzone: value })}
        />
        <RangeField
          label="Outer Scale"
          description="Expand or compress the outer edge so full tilt reaches 100% sooner or later."
          value={calibration.outerScale}
          min={0.5}
          max={1.5}
          step={0.01}
          formatter={(value) => `${value.toFixed(2)}x`}
          defaultValue={defaults.outerScale}
          onChange={(value) => onChange({ ...calibration, outerScale: value })}
        />
      </div>
    </div>
  );
}

function CalibrationTriggerCard({
  title,
  snapshot,
  calibration,
  defaults,
  onReset,
  onChange,
}: {
  title: string;
  snapshot: TriggerSnapshot;
  calibration: CalibrationProfile["leftTrigger"];
  defaults: CalibrationProfile["leftTrigger"];
  onReset: () => void;
  onChange: (next: CalibrationProfile["leftTrigger"]) => void;
}) {
  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">Trim initial slack and decide how much of the physical pull should map to full input.</p>
        </div>
        <button onClick={onReset} className="glass-button px-4 py-2 rounded-xl text-sm font-medium">
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            Reset Trigger
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TriggerMeter label="Raw" value={snapshot.normalized} rawValue={snapshot.rawValue} />
        <TriggerMeter label="Calibrated" value={snapshot.calibratedNormalized} rawValue={snapshot.calibratedValue} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RangeField
          label="Initial Deadzone"
          description="Ignore a small amount of trigger slack before input starts."
          value={calibration.deadzone}
          min={0}
          max={100}
          step={1}
          formatter={(value) => `${value.toFixed(0)}`}
          defaultValue={defaults.deadzone}
          onChange={(value) => onChange({ ...calibration, deadzone: Math.round(value) })}
        />
        <RangeField
          label="Maximum Physical Value"
          description="Lower this if the trigger cannot physically reach the factory maximum anymore."
          value={calibration.maxValue}
          min={100}
          max={255}
          step={1}
          formatter={(value) => `${value.toFixed(0)}`}
          defaultValue={defaults.maxValue}
          onChange={(value) => onChange({ ...calibration, maxValue: Math.round(value) })}
        />
      </div>
    </div>
  );
}

function RangeField({
  label,
  description,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
  defaultValue,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
  onChange: (value: number) => void;
  defaultValue?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between gap-4 mb-1">
        <label className="text-sm font-medium text-white/70">{label}</label>
        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-xs">
          {formatter(value)}
        </span>
      </div>
      <p className="text-xs text-white/40 mb-3 leading-relaxed">
        {description}
        {defaultValue !== undefined ? ` Default ${formatter(defaultValue)}.` : ""}
      </p>
      <div className="relative h-2 rounded-full bg-white/10">
        <div className="absolute top-0 left-0 h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(parseFloat(event.target.value))}
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function StickVisualizer({
  label,
  x,
  y,
}: {
  label: string;
  x: number;
  y: number;
}) {
  const left = `${((x + 1) / 2) * 100}%`;
  const top = `${((y + 1) / 2) * 100}%`;

  return (
    <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">{label}</div>
      <div className="relative aspect-square rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12),transparent_65%)]">
        <div className="absolute inset-x-1/2 top-0 bottom-0 w-px bg-white/10" />
        <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-white/10" />
        <div
          className="absolute w-4 h-4 rounded-full bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.75)] -translate-x-1/2 -translate-y-1/2"
          style={{ left, top }}
        />
      </div>
    </div>
  );
}

function TriggerMeter({
  label,
  value,
  rawValue,
}: {
  label: string;
  value: number;
  rawValue: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
      <div className="flex justify-between mb-3">
        <span className="text-xs uppercase tracking-[0.15em] text-white/35">{label}</span>
        <span className="text-xs text-white/45 font-mono">{rawValue}</span>
      </div>
      <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-sm text-white/55">{value.toFixed(3)}</div>
    </div>
  );
}

function stepToneClass(tone: StepTone) {
  switch (tone) {
    case "active":
      return "bg-blue-500/20 text-blue-100 border border-blue-400/30";
    case "complete":
      return "bg-emerald-500/20 text-emerald-100 border border-emerald-400/30";
    case "warning":
      return "bg-amber-500/20 text-amber-100 border border-amber-400/30";
    case "neutral":
      return "bg-white/10 text-white/75 border border-white/10";
  }
}

function formatMode(mode: "center" | "range") {
  return mode === "center" ? "Center" : "Range";
}

