import { Sparkles } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-zinc-50 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgb(99_102_241/0.25),transparent_55%)]" />
        <div className="relative flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sparkles className="size-5 text-indigo-400" />
          Job Finder
        </div>
        <div className="relative space-y-3">
          <p className="max-w-md text-balance text-2xl font-medium leading-snug tracking-tight">
            Every application personalized. Every send approved by you. Every
            reply tracked.
          </p>
          <p className="text-sm text-zinc-400">
            AI-assisted job hunting that respects recruiters — and your time.
          </p>
        </div>
        <p className="relative text-xs text-zinc-500">
          Powered by Gemini · Gmail OAuth · Supabase
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
