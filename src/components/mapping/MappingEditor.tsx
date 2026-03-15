import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Gamepad2,
  Keyboard,
  Pencil,
  Plus,
  Save,
  Sliders,
  Trash2,
} from "lucide-react";

import {
  CONTROLLER_BUTTONS,
  EMULATION_TARGET_OPTIONS,
  KEY_OPTIONS,
  MOUSE_BUTTON_OPTIONS,
  PLAYSTATION_BUTTON_OPTIONS,
  PLAYSTATION_STICK_OPTIONS,
  PLAYSTATION_TRIGGER_OPTIONS,
  XBOX_BUTTON_OPTIONS,
  XBOX_STICK_OPTIONS,
  XBOX_TRIGGER_OPTIONS,
  cloneMappingProfile,
  getButtonBinding,
  getControllerButtonBindingTypeForTarget,
  getControllerStickBindingTypeForTarget,
  getControllerTriggerBindingTypeForTarget,
  getEmulationFamily,
  getEmulationTargetDetails,
  getKeyCodeLabel,
  translateKeyboardCodeToKeyCode,
  type ButtonBindingTarget,
  type ControllerButton,
  type ControllerEmulationTarget,
  type KeyCode,
  type MappingProfile,
  type MouseButton,
  type PlayStationButton,
  type PlayStationStick,
  type PlayStationTrigger,
  type StickBinding,
  type TriggerBinding,
  type XboxButton,
  type XboxStick,
  type XboxTrigger,
} from "../../mapping";

interface MappingEditorProps {
  mappingProfile: MappingProfile;
  activeMappingProfileId: string | null;
  mappingPresets: MappingProfile[];
  customMappingProfiles: MappingProfile[];
  editingMappingProfile: MappingProfile | null;
  onSelectProfile: (profileId: string | null) => void;
  onCreateProfile: () => void;
  onSaveEditingProfile: (profile: MappingProfile) => void;
  onEditingProfileChange: (profile: MappingProfile | null) => void;
  onDeleteProfile: (profileId: string) => void;
  onLoadProfileForEditing: (profile: MappingProfile) => void;
  onEmulationTargetChange: (target: ControllerEmulationTarget) => void;
  onButtonBindingTypeChange: (button: ControllerButton, type: ButtonBindingTarget["type"]) => void;
  onButtonBindingChange: (button: ControllerButton, binding: ButtonBindingTarget) => void;
  onStickBindingChange: (side: "leftStick" | "rightStick", binding: StickBinding) => void;
  onTriggerBindingChange: (side: "leftTrigger" | "rightTrigger", binding: TriggerBinding) => void;
}

interface KeyCaptureState {
  id: string;
  label: string;
  error: string | null;
  onCapture: (key: KeyCode) => void;
}

export function MappingEditor({
  mappingProfile,
  activeMappingProfileId,
  mappingPresets,
  customMappingProfiles,
  editingMappingProfile,
  onSelectProfile,
  onCreateProfile,
  onSaveEditingProfile,
  onEditingProfileChange,
  onDeleteProfile,
  onLoadProfileForEditing,
  onEmulationTargetChange,
  onButtonBindingTypeChange,
  onButtonBindingChange,
  onStickBindingChange,
  onTriggerBindingChange,
}: MappingEditorProps) {
  const [activeKeyCapture, setActiveKeyCapture] = useState<KeyCaptureState | null>(null);
  const emulationDetails = getEmulationTargetDetails(mappingProfile.emulationTarget);
  const emulationFamily = getEmulationFamily(mappingProfile.emulationTarget);

  useEffect(() => {
    if (!activeKeyCapture) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        setActiveKeyCapture(null);
        return;
      }

      const translated = translateKeyboardCodeToKeyCode(event.code);
      if (!translated) {
        setActiveKeyCapture((current) =>
          current
            ? {
                ...current,
                error: `${event.code} is not supported yet. Use the dropdown to pick another key.`,
              }
            : null,
        );
        return;
      }

      activeKeyCapture.onCapture(translated);
      setActiveKeyCapture(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeKeyCapture]);

  const controllerButtonOptions = emulationFamily === "playstation"
    ? PLAYSTATION_BUTTON_OPTIONS
    : XBOX_BUTTON_OPTIONS;
  const controllerStickOptions = emulationFamily === "playstation"
    ? PLAYSTATION_STICK_OPTIONS
    : XBOX_STICK_OPTIONS;
  const controllerTriggerOptions = emulationFamily === "playstation"
    ? PLAYSTATION_TRIGGER_OPTIONS
    : XBOX_TRIGGER_OPTIONS;
  const controllerButtonType = getControllerButtonBindingTypeForTarget(mappingProfile.emulationTarget);
  const controllerStickType = getControllerStickBindingTypeForTarget(mappingProfile.emulationTarget);
  const controllerTriggerType = getControllerTriggerBindingTypeForTarget(mappingProfile.emulationTarget);
  const controllerButtonLabel = emulationFamily === "playstation" ? "PlayStation Button" : "Xbox Button";
  const controllerStickLabel = emulationFamily === "playstation" ? "PlayStation Stick" : "Xbox Stick";
  const controllerTriggerLabel = emulationFamily === "playstation" ? "PlayStation Trigger" : "Xbox Trigger";

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-4xl font-bold mb-2">Mapping</h2>
          <p className="text-white/50 max-w-3xl">
            Build a friendlier mapping layout with a dedicated profile library, direct key capture,
            and controller-style output targets for Xbox or older PlayStation emulation.
          </p>
        </div>
        <div className="glass-panel p-4 rounded-2xl min-w-[300px]">
          <div className="text-xs uppercase tracking-[0.2em] text-white/30 mb-2">Active Profile</div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Gamepad2 size={20} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{mappingProfile.name}</div>
              <div className="text-xs text-white/40">
                {activeMappingProfileId ? "Saved profile" : "Manual / Custom"} with {emulationDetails.label} output
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 mb-6">
        <ProfileLibraryCard
          activeMappingProfileId={activeMappingProfileId}
          mappingPresets={mappingPresets}
          customMappingProfiles={customMappingProfiles}
          editingMappingProfile={editingMappingProfile}
          onSelectProfile={onSelectProfile}
          onCreateProfile={onCreateProfile}
          onSaveEditingProfile={onSaveEditingProfile}
          onEditingProfileChange={onEditingProfileChange}
          onDeleteProfile={onDeleteProfile}
          onLoadProfileForEditing={onLoadProfileForEditing}
        />

        <div className="glass-panel p-6 rounded-3xl">
          <div className="flex items-start gap-4 mb-5">
            <div className="p-3 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/20">
              <Keyboard size={20} className="text-fuchsia-300" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">Output Target</h3>
              <p className="text-sm text-white/50">
                Choose which virtual controller family receives controller-style bindings. Keyboard
                and mouse bindings stay available in every profile.
              </p>
            </div>
          </div>

          <div className="relative mb-4">
            <select
              value={mappingProfile.emulationTarget}
              onChange={(event) => onEmulationTargetChange(event.target.value as ControllerEmulationTarget)}
              className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
            >
              {EMULATION_TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-neutral-900">
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white/80">{emulationDetails.label}</div>
                <div className="text-xs text-white/40 mt-1">{emulationDetails.description}</div>
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/45 bg-white/5 px-2 py-1 rounded-full">
                {emulationDetails.family}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <StickBindingCard
          title="Left Stick"
          subtitle="Keep analog movement on the virtual pad or turn it into keyboard directions."
          side="leftStick"
          binding={mappingProfile.leftStick}
          controllerLabel={controllerStickLabel}
          controllerType={controllerStickType}
          controllerOptions={controllerStickOptions}
          activeKeyCapture={activeKeyCapture}
          onStartKeyCapture={setActiveKeyCapture}
          onChange={onStickBindingChange}
        />
        <StickBindingCard
          title="Right Stick"
          subtitle="Use the second stick for camera control, mouse movement, or more keyboard input."
          side="rightStick"
          binding={mappingProfile.rightStick}
          controllerLabel={controllerStickLabel}
          controllerType={controllerStickType}
          controllerOptions={controllerStickOptions}
          activeKeyCapture={activeKeyCapture}
          onStartKeyCapture={setActiveKeyCapture}
          onChange={onStickBindingChange}
        />
        <TriggerBindingCard
          title="Left Trigger"
          subtitle="Bind L2 to the virtual controller, keyboard, mouse, or disable it."
          side="leftTrigger"
          binding={mappingProfile.leftTrigger}
          controllerLabel={controllerTriggerLabel}
          controllerType={controllerTriggerType}
          controllerOptions={controllerTriggerOptions}
          activeKeyCapture={activeKeyCapture}
          onStartKeyCapture={setActiveKeyCapture}
          onChange={onTriggerBindingChange}
        />
        <TriggerBindingCard
          title="Right Trigger"
          subtitle="Bind R2 to the virtual controller, keyboard, mouse, or disable it."
          side="rightTrigger"
          binding={mappingProfile.rightTrigger}
          controllerLabel={controllerTriggerLabel}
          controllerType={controllerTriggerType}
          controllerOptions={controllerTriggerOptions}
          activeKeyCapture={activeKeyCapture}
          onStartKeyCapture={setActiveKeyCapture}
          onChange={onTriggerBindingChange}
        />
      </div>

      <div className="glass-panel p-8 rounded-3xl">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-2xl font-semibold">Button Bindings</h3>
            <p className="text-white/45 text-sm mt-1">
              Each digital control can target the active virtual controller family, a keyboard key,
              a mouse button, or stay disabled.
            </p>
          </div>
          <div className="text-xs text-white/35 text-right max-w-xs">
            Press <span className="text-white/60">Escape</span> to cancel key capture. Unsupported
            keys will show an inline hint and keep listening.
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {CONTROLLER_BUTTONS.map((button) => (
            <MappingButtonRow
              key={button.id}
              button={button.id}
              label={button.label}
              description={button.description}
              binding={getButtonBinding(mappingProfile, button.id)}
              controllerButtonLabel={controllerButtonLabel}
              controllerButtonType={controllerButtonType}
              controllerButtonOptions={controllerButtonOptions}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={setActiveKeyCapture}
              onTypeChange={onButtonBindingTypeChange}
              onBindingChange={onButtonBindingChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileLibraryCard({
  activeMappingProfileId,
  mappingPresets,
  customMappingProfiles,
  editingMappingProfile,
  onSelectProfile,
  onCreateProfile,
  onSaveEditingProfile,
  onEditingProfileChange,
  onDeleteProfile,
  onLoadProfileForEditing,
}: Pick<
  MappingEditorProps,
  | "activeMappingProfileId"
  | "mappingPresets"
  | "customMappingProfiles"
  | "editingMappingProfile"
  | "onSelectProfile"
  | "onCreateProfile"
  | "onSaveEditingProfile"
  | "onEditingProfileChange"
  | "onDeleteProfile"
  | "onLoadProfileForEditing"
>) {
  const isRenaming = editingMappingProfile
    ? customMappingProfiles.some((profile) => profile.id === editingMappingProfile.id)
    : false;

  return (
    <div className="glass-panel p-6 rounded-3xl">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-1">Profile Library</h3>
          <p className="text-sm text-white/50">
            Switch between built-ins and saved mappings here. Saving and renaming now stay inside
            the Mapping tab instead of jumping to Settings.
          </p>
        </div>
        <button
          onClick={onCreateProfile}
          className="glass-button flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
        >
          <Plus size={15} /> Save Current as Profile
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-5">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/30 mb-2">Choose Profile</div>
          <div className="relative mb-3">
            <select
              value={activeMappingProfileId ?? ""}
              onChange={(event) => onSelectProfile(event.target.value || null)}
              className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
            >
              <option value="" className="bg-neutral-900">Manual / Custom</option>
              {mappingPresets.map((preset) => (
                <option key={preset.id} value={preset.id} className="bg-neutral-900">
                  {preset.name} (Built-in)
                </option>
              ))}
              {customMappingProfiles.map((profile) => (
                <option key={profile.id} value={profile.id} className="bg-neutral-900">
                  {profile.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
          </div>
          <div className="text-xs text-white/35">
            Built-ins apply instantly. Editing an active custom profile updates that saved profile automatically.
          </div>
        </div>

        <div className="space-y-3">
          {customMappingProfiles.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-white/35">
              No custom mapping profiles yet. Save the current layout to create one.
            </div>
          )}

          {customMappingProfiles.map((profile) => (
            <div
              key={profile.id}
              className={`rounded-2xl border p-4 ${
                activeMappingProfileId === profile.id
                  ? "border-blue-500/25 bg-blue-500/10"
                  : "border-white/8 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{profile.name}</div>
                  <div className="text-xs text-white/40 mt-1">
                    {getEmulationTargetDetails(profile.emulationTarget).label}
                  </div>
                </div>
                {activeMappingProfileId === profile.id && (
                  <span className="text-[10px] uppercase tracking-[0.2em] text-blue-200 bg-blue-500/10 px-2 py-1 rounded-full">
                    Active
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => onSelectProfile(profile.id)}
                  className="glass-button px-3 py-2 rounded-lg text-xs font-medium"
                >
                  Use
                </button>
                <button
                  onClick={() => onLoadProfileForEditing(profile)}
                  className="glass-button px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <Pencil size={13} /> Rename
                </button>
                <button
                  onClick={() => onDeleteProfile(profile.id)}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editingMappingProfile && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h4 className="text-lg font-semibold">{isRenaming ? "Rename Profile" : "Save New Profile"}</h4>
              <p className="text-sm text-white/45 mt-1">
                This saves the current mapping snapshot, including the selected output target.
              </p>
            </div>
            <button
              onClick={() => onEditingProfileChange(null)}
              className="glass-button px-3 py-2 rounded-lg text-sm font-medium text-white/60"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Profile Name</label>
              <input
                type="text"
                value={editingMappingProfile.name}
                placeholder="My Favorite Layout"
                onChange={(event) => onEditingProfileChange({
                  ...cloneMappingProfile(editingMappingProfile),
                  name: event.target.value,
                })}
                className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
              />
            </div>
            <button
              disabled={!editingMappingProfile.name.trim()}
              onClick={() => onSaveEditingProfile(editingMappingProfile)}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Save size={15} /> Save Profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MappingButtonRow({
  button,
  label,
  description,
  binding,
  controllerButtonLabel,
  controllerButtonType,
  controllerButtonOptions,
  activeKeyCapture,
  onStartKeyCapture,
  onTypeChange,
  onBindingChange,
}: {
  button: ControllerButton;
  label: string;
  description: string;
  binding: ButtonBindingTarget;
  controllerButtonLabel: string;
  controllerButtonType: Extract<ButtonBindingTarget["type"], "xboxButton" | "playstationButton">;
  controllerButtonOptions: Array<{ value: XboxButton | PlayStationButton; label: string }>;
  activeKeyCapture: KeyCaptureState | null;
  onStartKeyCapture: (state: KeyCaptureState | null) => void;
  onTypeChange: (button: ControllerButton, type: ButtonBindingTarget["type"]) => void;
  onBindingChange: (button: ControllerButton, binding: ButtonBindingTarget) => void;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-white/40 mt-1">{description}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <SelectField
          value={binding.type}
          options={[
            { value: "disabled", label: "Disabled" },
            { value: controllerButtonType, label: controllerButtonLabel },
            { value: "keyboardKey", label: "Keyboard Key" },
            { value: "mouseButton", label: "Mouse Button" },
          ]}
          onChange={(value) => onTypeChange(button, value as ButtonBindingTarget["type"])}
        />

        {binding.type === "disabled" && <div className="text-sm text-white/35">No output.</div>}

        {binding.type === controllerButtonType && (
          <SelectField
            value={binding.button}
            options={controllerButtonOptions}
            onChange={(value) =>
              onBindingChange(
                button,
                controllerButtonType === "playstationButton"
                  ? { type: "playstationButton", button: value as PlayStationButton }
                  : { type: "xboxButton", button: value as XboxButton },
              )
            }
          />
        )}

        {binding.type === "keyboardKey" && (
          <KeyBindingField
            captureId={`button-${button}`}
            label="Keyboard Key"
            value={binding.key}
            activeKeyCapture={activeKeyCapture}
            onStartKeyCapture={onStartKeyCapture}
            onChange={(value) => onBindingChange(button, { type: "keyboardKey", key: value })}
          />
        )}

        {binding.type === "mouseButton" && (
          <SelectField
            value={binding.button}
            options={MOUSE_BUTTON_OPTIONS}
            onChange={(value) => onBindingChange(button, { type: "mouseButton", button: value as MouseButton })}
          />
        )}
      </div>
    </div>
  );
}

function StickBindingCard({
  title,
  subtitle,
  side,
  binding,
  controllerLabel,
  controllerType,
  controllerOptions,
  activeKeyCapture,
  onStartKeyCapture,
  onChange,
}: {
  title: string;
  subtitle: string;
  side: "leftStick" | "rightStick";
  binding: StickBinding;
  controllerLabel: string;
  controllerType: Extract<StickBinding["type"], "xboxStick" | "playstationStick">;
  controllerOptions: Array<{ value: XboxStick | PlayStationStick; label: string }>;
  activeKeyCapture: KeyCaptureState | null;
  onStartKeyCapture: (state: KeyCaptureState | null) => void;
  onChange: (side: "leftStick" | "rightStick", binding: StickBinding) => void;
}) {
  const duplicateKeys = useMemo(() => {
    if (binding.type !== "keyboard4") {
      return [];
    }
    return getDuplicateKeyLabels([binding.up, binding.down, binding.left, binding.right]);
  }, [binding]);

  const defaultControllerStick = side === "leftStick" ? "left" : "right";

  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">{subtitle}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Gamepad2 size={20} className="text-blue-400" />
        </div>
      </div>

      <div className="space-y-5">
        <SelectField
          value={binding.type}
          options={[
            { value: "disabled", label: "Disabled" },
            { value: controllerType, label: controllerLabel },
            { value: "keyboard4", label: "Keyboard 4-Way" },
            { value: "mouseMove", label: "Mouse Move" },
          ]}
          onChange={(value) => {
            const nextType = value as StickBinding["type"];
            if (nextType === "disabled") onChange(side, { type: "disabled" });
            if (nextType === "keyboard4") {
              onChange(side, { type: "keyboard4", up: "w", down: "s", left: "a", right: "d", threshold: 0.35 });
            }
            if (nextType === "mouseMove") {
              onChange(side, { type: "mouseMove", sensitivity: 18, deadzone: 0.2 });
            }
            if (nextType === "xboxStick") {
              onChange(side, { type: "xboxStick", stick: defaultControllerStick as XboxStick });
            }
            if (nextType === "playstationStick") {
              onChange(side, { type: "playstationStick", stick: defaultControllerStick as PlayStationStick });
            }
          }}
        />

        {binding.type === "disabled" && <div className="text-sm text-white/35">This stick will not send mapped output.</div>}

        {binding.type === controllerType && (
          <SelectField
            value={binding.stick}
            options={controllerOptions}
            onChange={(value) =>
              onChange(
                side,
                controllerType === "playstationStick"
                  ? { type: "playstationStick", stick: value as PlayStationStick }
                  : { type: "xboxStick", stick: value as XboxStick },
              )
            }
          />
        )}

        {binding.type === "keyboard4" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KeyBindingField
              captureId={`${side}-up`}
              label="Up"
              value={binding.up}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={onStartKeyCapture}
              onChange={(value) => onChange(side, { ...binding, up: value })}
            />
            <KeyBindingField
              captureId={`${side}-down`}
              label="Down"
              value={binding.down}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={onStartKeyCapture}
              onChange={(value) => onChange(side, { ...binding, down: value })}
            />
            <KeyBindingField
              captureId={`${side}-left`}
              label="Left"
              value={binding.left}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={onStartKeyCapture}
              onChange={(value) => onChange(side, { ...binding, left: value })}
            />
            <KeyBindingField
              captureId={`${side}-right`}
              label="Right"
              value={binding.right}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={onStartKeyCapture}
              onChange={(value) => onChange(side, { ...binding, right: value })}
            />
            <RangeField
              label="Threshold"
              value={binding.threshold}
              min={0.1}
              max={0.9}
              step={0.05}
              formatter={(value) => value.toFixed(2)}
              onChange={(value) => onChange(side, { ...binding, threshold: value })}
            />
          </div>
        )}

        {binding.type === "keyboard4" && duplicateKeys.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Duplicate directional keys detected: {duplicateKeys.join(", ")}.
          </div>
        )}

        {binding.type === "mouseMove" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RangeField
              label="Sensitivity"
              value={binding.sensitivity}
              min={1}
              max={40}
              step={1}
              formatter={(value) => `${value.toFixed(0)} px/tick`}
              onChange={(value) => onChange(side, { ...binding, sensitivity: value })}
            />
            <RangeField
              label="Deadzone"
              value={binding.deadzone}
              min={0}
              max={0.8}
              step={0.05}
              formatter={(value) => value.toFixed(2)}
              onChange={(value) => onChange(side, { ...binding, deadzone: value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerBindingCard({
  title,
  subtitle,
  side,
  binding,
  controllerLabel,
  controllerType,
  controllerOptions,
  activeKeyCapture,
  onStartKeyCapture,
  onChange,
}: {
  title: string;
  subtitle: string;
  side: "leftTrigger" | "rightTrigger";
  binding: TriggerBinding;
  controllerLabel: string;
  controllerType: Extract<TriggerBinding["type"], "xboxTrigger" | "playstationTrigger">;
  controllerOptions: Array<{ value: XboxTrigger | PlayStationTrigger; label: string }>;
  activeKeyCapture: KeyCaptureState | null;
  onStartKeyCapture: (state: KeyCaptureState | null) => void;
  onChange: (side: "leftTrigger" | "rightTrigger", binding: TriggerBinding) => void;
}) {
  const defaultControllerTrigger = side === "leftTrigger" ? "left" : "right";

  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">{subtitle}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <Sliders size={20} className="text-purple-400" />
        </div>
      </div>

      <div className="space-y-5">
        <SelectField
          value={binding.type}
          options={[
            { value: "disabled", label: "Disabled" },
            { value: controllerType, label: controllerLabel },
            { value: "keyboardKey", label: "Keyboard Key" },
            { value: "mouseButton", label: "Mouse Button" },
          ]}
          onChange={(value) => {
            const nextType = value as TriggerBinding["type"];
            if (nextType === "disabled") onChange(side, { type: "disabled" });
            if (nextType === "keyboardKey") onChange(side, { type: "keyboardKey", key: "space", threshold: 40 });
            if (nextType === "mouseButton") onChange(side, { type: "mouseButton", button: "left", threshold: 40 });
            if (nextType === "xboxTrigger") {
              onChange(side, { type: "xboxTrigger", trigger: defaultControllerTrigger as XboxTrigger });
            }
            if (nextType === "playstationTrigger") {
              onChange(side, { type: "playstationTrigger", trigger: defaultControllerTrigger as PlayStationTrigger });
            }
          }}
        />

        {binding.type === "disabled" && <div className="text-sm text-white/35">This trigger will not send mapped output.</div>}

        {binding.type === controllerType && (
          <SelectField
            value={binding.trigger}
            options={controllerOptions}
            onChange={(value) =>
              onChange(
                side,
                controllerType === "playstationTrigger"
                  ? { type: "playstationTrigger", trigger: value as PlayStationTrigger }
                  : { type: "xboxTrigger", trigger: value as XboxTrigger },
              )
            }
          />
        )}

        {binding.type === "keyboardKey" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KeyBindingField
              captureId={`${side}-key`}
              label="Key"
              value={binding.key}
              activeKeyCapture={activeKeyCapture}
              onStartKeyCapture={onStartKeyCapture}
              onChange={(value) => onChange(side, { ...binding, key: value })}
            />
            <RangeField
              label="Activation Threshold"
              value={binding.threshold}
              min={1}
              max={255}
              step={1}
              formatter={(value) => value.toFixed(0)}
              onChange={(value) => onChange(side, { ...binding, threshold: Math.round(value) })}
            />
          </div>
        )}

        {binding.type === "mouseButton" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectField
              label="Mouse Button"
              value={binding.button}
              options={MOUSE_BUTTON_OPTIONS}
              onChange={(value) => onChange(side, { ...binding, button: value as MouseButton })}
            />
            <RangeField
              label="Activation Threshold"
              value={binding.threshold}
              min={1}
              max={255}
              step={1}
              formatter={(value) => value.toFixed(0)}
              onChange={(value) => onChange(side, { ...binding, threshold: Math.round(value) })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function KeyBindingField({
  captureId,
  label,
  value,
  activeKeyCapture,
  onStartKeyCapture,
  onChange,
}: {
  captureId: string;
  label: string;
  value: KeyCode;
  activeKeyCapture: KeyCaptureState | null;
  onStartKeyCapture: (state: KeyCaptureState | null) => void;
  onChange: (value: KeyCode) => void;
}) {
  const isListening = activeKeyCapture?.id === captureId;

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">{label}</div>
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <Keyboard size={15} className="text-white/70" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{getKeyCodeLabel(value)}</div>
              <div className="text-xs text-white/40">Current key</div>
            </div>
          </div>
          <button
            onClick={() =>
              onStartKeyCapture(
                isListening
                  ? null
                  : {
                      id: captureId,
                      label,
                      error: null,
                      onCapture: onChange,
                    },
              )
            }
            className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              isListening
                ? "bg-blue-500/20 text-blue-100"
                : "glass-button"
            }`}
          >
            {isListening ? "Listening..." : "Press Key"}
          </button>
        </div>

        <SelectField
          value={value}
          options={KEY_OPTIONS}
          onChange={(nextValue) => onChange(nextValue as KeyCode)}
        />

        {isListening && (
          <div className="mt-3 text-xs text-white/45">
            Press the key you want to bind now. Escape cancels capture.
          </div>
        )}

        {isListening && activeKeyCapture?.error && (
          <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {activeKeyCapture.error}
          </div>
        )}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      {label && <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">{label}</div>}
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-neutral-900">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-2">
        <label className="text-sm font-medium text-white/70">{label}</label>
        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-xs">
          {formatter(value)}
        </span>
      </div>
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

function getDuplicateKeyLabels(keys: KeyCode[]) {
  const counts = new Map<KeyCode, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => getKeyCodeLabel(key));
}
