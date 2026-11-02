import { useRef } from 'react'

interface Props {
  onFile: (file: File) => void
  busy: boolean
}

const TIPS: Array<{ title: string; body: string }> = [
  {
    title: 'Cadre le corps entier',
    body: 'Des pieds à la tête, avec un peu de marge au-dessus. Si les pieds sortent du cadre, l’analyse des appuis est perdue.',
  },
  {
    title: 'Filme en ralenti si tu peux',
    body: 'À 30 i/s, la descente ne dure que 7 images : l’impact est forcément approximatif. Le mode ralenti (120 ou 240 i/s) change tout.',
  },
  {
    title: 'Téléphone posé, pas tenu',
    body: 'Cale-le contre un sac ou un chariot, à hauteur de hanches, perpendiculaire à toi. Une caméra qui bouge fausse toutes les mesures.',
  },
  {
    title: 'Deux angles valent mieux qu’un',
    body: 'De face : sway, chicken wing, équilibre. De derrière dans l’axe : posture, early extension. Aucun angle ne montre tout.',
  },
]

export function UploadScreen({ onFile, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-7 px-4 pb-12 pt-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent/15 text-lg">⛳</span>
          <span className="text-sm font-semibold tracking-[0.18em] text-muted uppercase">SwingLab</span>
        </div>
        <h1 className="text-[1.75rem] leading-tight font-semibold">
          Filme ton swing,
          <br />
          obtiens un diagnostic.
        </h1>
        <p className="text-[0.95rem] leading-relaxed text-muted">
          L&rsquo;analyse tourne entièrement dans ton téléphone. Ta vidéo n&rsquo;est
          envoyée nulle part et ne quitte jamais l&rsquo;appareil.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-2xl bg-accent px-5 py-4 text-base font-semibold text-ink transition active:scale-[0.99] disabled:opacity-50"
        >
          Choisir une vidéo
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Réinitialise la valeur pour permettre de re-sélectionner le même fichier.
            e.target.value = ''
            if (file) onFile(file)
          }}
        />
        <p className="text-center text-xs text-muted">MP4, MOV ou WebM &middot; 2 à 10 secondes suffisent</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Pour une analyse exploitable
        </h2>
        <ul className="flex flex-col gap-2.5">
          {TIPS.map((tip) => (
            <li key={tip.title} className="rounded-xl border border-line bg-surface p-3.5">
              <p className="text-sm font-semibold">{tip.title}</p>
              <p className="mt-1 text-[0.82rem] leading-relaxed text-muted">{tip.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
