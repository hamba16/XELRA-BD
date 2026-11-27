import { useState } from "react";
import type { Profile } from "./data";
import { removeProfileImage, uploadProfileImage } from "./data";
import type { FinanceChartStyle, WorkspacePreferences } from "./workspace-preferences";
import { WorkspaceIcon } from "./WorkspaceMotifs";

type Props = {
  profile: Profile;
  preferences: WorkspacePreferences;
  avatarUrl: string;
  avatarStatus: string;
  canUploadAvatar: boolean;
  onPreferencesChange: (preferences: WorkspacePreferences) => void;
  onAvatarChange: (url: string) => void;
  onAvatarStatus: (status: string) => void;
  onBack: () => void;
  onSignOut: () => void;
};

const chartOptions: { value: FinanceChartStyle; label: string; detail: string }[] = [
  { value: "columns", label: "Columns", detail: "Compare amounts month by month" },
  { value: "line", label: "Line", detail: "Follow movement over time" },
  { value: "area", label: "Area", detail: "Emphasize month-to-month magnitude" },
];

async function prepareAvatar(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Choose a JPEG, PNG or WebP profile photo.");
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw Error("Choose a profile photo smaller than 5 MB.");
  const image = await createImageBitmap(file);
  try {
    const side = Math.min(image.width, image.height);
    if (side < 1) throw Error("This profile photo could not be read.");
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw Error("This browser could not prepare the profile photo.");
    if (image.width > 8000 || image.height > 8000 || image.width * image.height > 25000000)
      throw Error("Choose a profile photo with dimensions no larger than 25 megapixels.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size > 256 * 1024)
      throw Error("This profile photo could not be reduced to the 256 KB upload limit.");
    return blob;
  } finally {
    image.close();
  }
}

export default function WorkspaceSettings({
  profile,
  preferences,
  avatarUrl,
  avatarStatus,
  canUploadAvatar,
  onPreferencesChange,
  onAvatarChange,
  onAvatarStatus,
  onBack,
  onSignOut,
}: Props) {
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  async function upload(file: File | undefined) {
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const image = await prepareAvatar(file);
      const url = await uploadProfileImage(profile.id, image);
      onAvatarChange(url);
      onAvatarStatus("Profile photo updated. It is stored privately with your account.");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "The profile photo could not be uploaded.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function remove() {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      await removeProfileImage(profile.id);
      onAvatarChange("");
      onAvatarStatus("Profile photo removed.");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "The profile photo could not be removed.");
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="settings-layout">
      <div className="settings-mobile-content">
        <header className="settings-mobile-header">
          <button type="button" aria-label="Back to workspace" onClick={onBack}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h11" /></svg>
          </button>
          <h2>Settings</h2>
          <span aria-hidden="true" />
        </header>
        <section className="settings-mobile-profile" aria-label="Your profile">
          <span className="settings-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{profile.name.trim().slice(0, 1).toUpperCase()}</span>}
          </span>
          <div><strong>{profile.name}</strong><small>{profile.principal.replaceAll("_", " ")} · {profile.divisions.join(", ") || "No division assigned"}</small></div>
          <a href="#settings-profile">Edit</a>
        </section>
        <nav className="settings-mobile-menu" aria-label="Settings shortcuts">
          <a href="#settings-profile"><span className="settings-menu-icon"><WorkspaceIcon name="people" /></span><span><strong>Profile & photo</strong><small>Your name and profile image</small></span><b aria-hidden="true">›</b></a>
          <a href="#settings-appearance"><span className="settings-menu-icon"><WorkspaceIcon name="settings" /></span><span><strong>Appearance</strong><small>{preferences.theme === "light" ? "Light theme" : "Dark theme"}</small></span><b aria-hidden="true">›</b></a>
          <a href="#settings-finance"><span className="settings-menu-icon"><WorkspaceIcon name="finance" /></span><span><strong>Finance visuals</strong><small>{chartOptions.find(option => option.value === preferences.financeChartStyle)?.label} charts</small></span><b aria-hidden="true">›</b></a>
          <button type="button" className="settings-mobile-signout" onClick={onSignOut}>
            <span className="settings-menu-icon" aria-hidden="true">↗</span><span>Sign out</span>
          </button>
        </nav>
      </div>
      <nav className="settings-nav" aria-label="Settings sections">
        <a href="#settings-profile">Profile</a>
        <a href="#settings-appearance">Appearance</a>
        <p>Changes apply to this profile only.</p>
      </nav>
      <div className="settings-sections">
        <section id="settings-profile" className="settings-card">
          <div className="settings-section-copy">
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h2>Profile</h2>
            <p className="muted">Personalize your XELRA workspace identity.</p>
          </div>
          <div className="settings-profile-content">
            <div className="settings-identity">
              <span className="settings-avatar" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{profile.name.trim().slice(0, 1).toUpperCase()}</span>}
              </span>
              <div>
                <strong>{profile.name}</strong>
                <p>{profile.principal.replaceAll("_", " ")} · {profile.divisions.join(", ") || "No division assigned"}</p>
              </div>
            </div>
            <div className="settings-profile-fields">
              <label>
                Display name
                <input value={profile.name} readOnly />
              </label>
              <label>
                Workspace role
                <input value={profile.principal.replaceAll("_", " ")} readOnly />
              </label>
            </div>
            <div className="settings-avatar-actions">
              <label className="settings-upload">
                {avatarBusy ? "Saving photo…" : "Upload profile photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Upload profile photo"
                  disabled={!canUploadAvatar || avatarBusy}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void upload(file);
                  }}
                />
              </label>
              {avatarUrl && <button type="button" disabled={!canUploadAvatar || avatarBusy} onClick={() => void remove()}>Remove photo</button>}
              {!canUploadAvatar && <small>Photo uploads are disabled in the synthetic preview. In a live workspace, images are private to your account.</small>}
              {avatarError && <p role="alert" className="notice error">{avatarError}</p>}
              {avatarStatus && <p role="status">{avatarStatus}</p>}
            </div>
          </div>
        </section>

        <section id="settings-appearance" className="settings-card">
          <div className="settings-section-copy">
            <p className="eyebrow">WORKSPACE DISPLAY</p>
            <h2>Appearance</h2>
            <p className="muted">Choose how XELRA presents information on this device.</p>
          </div>
          <div className="settings-controls">
            <fieldset id="settings-finance" className="settings-choice-group">
              <legend>Colour theme</legend>
              <div className="settings-choice-grid settings-theme-options">
                {(["light", "dark"] as const).map(theme => (
                  <button key={theme} type="button" aria-pressed={preferences.theme === theme} onClick={() => onPreferencesChange({ ...preferences, theme })}>
                    <span className={`theme-swatch theme-swatch--${theme}`} aria-hidden="true" />
                    <strong>{theme === "light" ? "Light" : "Dark"}</strong>
                    <small>{theme === "light" ? "Clear paper surfaces" : "Low-light contrast"}</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="settings-choice-group">
              <legend>Finance chart style</legend>
              <p className="muted">Used across every finance dashboard. This changes presentation only, not the underlying figures.</p>
              <div className="settings-choice-grid">
                {chartOptions.map(option => (
                  <button key={option.value} type="button" aria-pressed={preferences.financeChartStyle === option.value} onClick={() => onPreferencesChange({ ...preferences, financeChartStyle: option.value })}>
                    <span className={`chart-swatch chart-swatch--${option.value}`} aria-hidden="true"><i /><i /><i /><i /></span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      </div>
    </div>
  );
}
