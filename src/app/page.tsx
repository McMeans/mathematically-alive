import { Logo } from "./Logo";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-16 sm:px-8">
      <div className="flex items-center gap-4">
        <Logo size={72} decorative />
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">
          mathematically <span className="text-turf">alive</span>
        </h1>
      </div>
      <p className="text-lg text-ink-soft sm:text-xl">Every path to the playoff, for every team.</p>
      <p className="text-sm text-ink-muted">Pick a team. Coming soon.</p>
    </main>
  );
}
