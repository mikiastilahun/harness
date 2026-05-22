<script lang="ts">
  import * as Popover from "$lib/components/ui/popover"
  import { Button } from "$lib/components/ui/button"
  import { Input } from "$lib/components/ui/input"
  import { Separator } from "$lib/components/ui/separator"
  import BookOpen from "@lucide/svelte/icons/book-open"
  import Plus from "@lucide/svelte/icons/plus"
  import X from "@lucide/svelte/icons/x"
  import Loader from "@lucide/svelte/icons/loader-circle"
  import ExternalLink from "@lucide/svelte/icons/external-link"
  import { toast } from "svelte-sonner"
  import { type SkillSearchHit, type AttachedSkill, searchSkills, attachSkillFrom } from "$lib/skills"

  type Props = {
    skills: AttachedSkill[]
    onAdd: (s: AttachedSkill) => void
    onRemove: (id: string) => void
  }

  let { skills, onAdd, onRemove }: Props = $props()

  let open = $state(false)
  let query = $state("")
  let results = $state<SkillSearchHit[]>([])
  let searching = $state(false)
  let attaching = $state<string | null>(null)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const isAttached = (id: string) => skills.some((s) => s.id === id)

  const runSearch = async (q: string) => {
    if (q.trim().length < 2) {
      results = []
      searching = false
      return
    }
    searching = true
    try {
      results = await searchSkills(q, 10)
    } catch (e) {
      toast.error(`Search failed: ${(e as Error).message}`)
    } finally {
      searching = false
    }
  }

  $effect(() => {
    const q = query
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => runSearch(q), q.length < 3 ? 250 : 150)
  })

  const add = async (hit: SkillSearchHit) => {
    if (isAttached(hit.id) || attaching) return
    attaching = hit.id
    try {
      const skill = await attachSkillFrom(hit)
      onAdd(skill)
      toast.success(`Added ${skill.name}`)
    } catch (e) {
      toast.error(`Attach failed: ${(e as Error).message}`)
    } finally {
      attaching = null
    }
  }

  const formatInstalls = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} size="sm" variant="outline" class="h-8 gap-1.5">
        <BookOpen class="size-3.5" />
        <span class="text-xs">Skills</span>
        {#if skills.length > 0}
          <span class="rounded bg-muted px-1 text-[10px] font-mono">{skills.length}</span>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[420px] p-0" align="end">
    <div class="border-b border-border p-2">
      <Input
        placeholder="Search skills.sh (react, testing, design, …)"
        bind:value={query}
        class="h-8 text-xs"
      />
    </div>

    {#if skills.length > 0}
      <div class="p-2">
        <div class="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Attached ({skills.length})
        </div>
        <div class="flex flex-col gap-0.5">
          {#each skills as s (s.id)}
            <div class="group flex items-start justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-medium">{s.name}</div>
                {#if s.description}
                  <div class="line-clamp-2 text-[10px] text-muted-foreground">{s.description}</div>
                {/if}
                <div class="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{s.source}</div>
              </div>
              <button
                type="button"
                onclick={() => onRemove(s.id)}
                class="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                aria-label="Remove skill"
              >
                <X class="size-3.5" />
              </button>
            </div>
          {/each}
        </div>
      </div>
      <Separator />
    {/if}

    <div class="max-h-64 overflow-y-auto p-2">
      {#if query.trim().length < 2}
        <div class="px-2 py-4 text-center text-[11px] text-muted-foreground">
          Type 2+ characters to search the
          <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" class="underline">
            skills.sh
          </a>
          registry.
        </div>
      {:else if searching}
        <div class="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader class="size-3 animate-spin" />
          Searching…
        </div>
      {:else if results.length === 0}
        <div class="px-2 py-4 text-center text-[11px] text-muted-foreground">No matches.</div>
      {:else}
        <div class="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Results</div>
        <div class="flex flex-col gap-0.5">
          {#each results as r (r.id)}
            {@const already = isAttached(r.id)}
            <div class="flex items-start justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-medium">{r.name}</span>
                  <a
                    href={`https://www.skills.sh/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-muted-foreground hover:text-foreground"
                    aria-label="Open on skills.sh"
                  >
                    <ExternalLink class="size-3" />
                  </a>
                </div>
                <div class="truncate text-[10px] text-muted-foreground">
                  {r.source} · {formatInstalls(r.installs)} installs
                </div>
              </div>
              <button
                type="button"
                onclick={() => add(r)}
                disabled={already || attaching === r.id}
                class="rounded-sm border border-border px-2 py-1 text-[10px] text-foreground hover:bg-background disabled:opacity-50"
              >
                {#if attaching === r.id}
                  <Loader class="size-3 animate-spin" />
                {:else if already}
                  Added
                {:else}
                  <span class="flex items-center gap-1"><Plus class="size-3" /> Add</span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
