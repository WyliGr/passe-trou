// Hand-picked 16px outline icons (24x24 grid, 1.5px stroke, lucide-style paths — no icon library).

type IconProps = { className?: string };

function base(props: IconProps, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className}
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) =>
  base(p, <path d="M22 12h-4l-3 9L9 3l-3 9H2" />);

export const IconAnalytics = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M3 3v18h18" />
      <path d="M8 17v-6" />
      <path d="M13 17V7" />
      <path d="M18 17v-3" />
    </>,
  );

export const IconRequests = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>,
  );

export const IconProviders = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="2" y="3" width="20" height="7" rx="2" />
      <rect x="2" y="14" width="20" height="7" rx="2" />
      <path d="M6 6.5h.01" />
      <path d="M6 17.5h.01" />
    </>,
  );

export const IconModels = (p: IconProps) =>
  base(
    p,
    <>
      <path d="m12 2 10 5-10 5L2 7l10-5Z" />
      <path d="m2 12 10 5 10-5" />
      <path d="m2 17 10 5 10-5" />
    </>,
  );

export const IconMembers = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  );

export const IconPricing = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42Z" />
      <circle cx="7.5" cy="7.5" r=".8" />
    </>,
  );

export const IconLogout = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  );

export const IconClose = (p: IconProps) =>
  base(p, <path d="M18 6 6 18M6 6l12 12" />);

export const IconChevron = (p: IconProps) =>
  base(p, <path d="m9 18 6-6-6-6" />);
