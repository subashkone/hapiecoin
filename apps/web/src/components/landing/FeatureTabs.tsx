"use client";
// "Platform Features" tabbed section of the landing page (client: Radix tabs).
import { CircleCheck, Tabs, TabsContent, TabsList, TabsTrigger } from "@hapiecoin/ui";
import { FEATURE_TABS } from "@/content/landing";

export function FeatureTabs() {
  return (
    <Tabs defaultValue={FEATURE_TABS[0].id} variant="segmented">
      <TabsList aria-label="Feature areas">
        {FEATURE_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {FEATURE_TABS.map((t) => (
        <TabsContent key={t.id} value={t.id}>
          <ul className="grid gap-2 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
            {t.bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-[13px]">
                <CircleCheck className="size-4 shrink-0 text-profit" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        </TabsContent>
      ))}
    </Tabs>
  );
}
