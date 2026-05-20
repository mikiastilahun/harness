<script lang="ts">
  import { Popover as PopoverPrimitive } from "bits-ui"
  import { cn, type WithoutChild } from "$lib/utils.js"

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    align = "start",
    ...restProps
  }: WithoutChild<PopoverPrimitive.ContentProps> = $props()
</script>

<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content
    bind:ref
    {sideOffset}
    {align}
    data-slot="popover-content"
    class={cn(
      "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 z-50 rounded-lg p-3 shadow-md ring-1 outline-none",
      className,
    )}
    {...restProps}
  />
</PopoverPrimitive.Portal>
