/**
 * Chargement du profil de référence publié avec le site.
 *
 * Absent par défaut : tant qu'aucun corpus n'a été mesuré, l'app n'affiche
 * aucune comparaison plutôt qu'une comparaison inventée.
 */

import { isReferenceProfile, type ReferenceProfile } from '../core/reference'

const PROFILE_URL = `${import.meta.env.BASE_URL}reference/profile.json`

export async function loadReferenceProfile(): Promise<ReferenceProfile | null> {
  try {
    const res = await fetch(PROFILE_URL, { cache: 'no-cache' })
    if (!res.ok) return null
    // Même piège que pour le modèle : un repli SPA renvoie index.html en 200.
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('json')) return null
    const data: unknown = await res.json()
    return isReferenceProfile(data) ? data : null
  } catch {
    return null
  }
}
