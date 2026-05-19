// Instagram-style default profile silhouette as an inline SVG data URI.
// Used as the fallback when a user has not uploaded an avatar.
export const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#e5e7eb"/>
      <circle cx="50" cy="40" r="16" fill="#9ca3af"/>
      <path d="M18 92c0-17.673 14.327-32 32-32s32 14.327 32 32v8H18z" fill="#9ca3af"/>
    </svg>`
  );

export const getAvatarUrl = (avatarUrl?: string | null): string =>
  avatarUrl && avatarUrl.trim() !== '' ? avatarUrl : DEFAULT_AVATAR;
