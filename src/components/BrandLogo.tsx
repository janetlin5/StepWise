export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500 text-white shadow-sm shadow-cyan-200">
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M5 16.5h4.5V12H14V7.5h5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          />
          <path
            d="M18.5 5.5l.55 1.2 1.2.55-1.2.55-.55 1.2-.55-1.2-1.2-.55 1.2-.55.55-1.2Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="font-bold text-cyan-600">StepWise</span>
    </span>
  );
}
