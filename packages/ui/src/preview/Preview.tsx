// Component preview: every @hapiecoin/ui component in both themes, side by side.
// Used by apps/web at /_preview and by the Phase 2 Playwright visual test (screenshots per data-section).
// Traceability: HC-PB-022, HC-PB-060 (both themes via tokens), HC-SH-080 / HC-SH-113 (density rows).
import { useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { Kbd } from "../components/Kbd";
import { Label } from "../components/Label";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { Stat } from "../components/Stat";
import { Switch } from "../components/Switch";
import { TBody, THead, Table, Td, Th, Tr } from "../components/Table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/Tabs";
import { Textarea } from "../components/Textarea";
import { Toaster, toast } from "../components/Toaster";
import { Tooltip, TooltipProvider } from "../components/Tooltip";
import { Inbox } from "../icons";
import { cn } from "../lib/cn";

const BUTTON_VARIANTS = ["primary", "secondary", "outline", "ghost", "destructive", "buy", "sell"] as const;
const BUTTON_SIZES = ["xs", "sm", "md", "lg"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "buy",
  "sell",
  "profit",
  "loss",
  "warning",
  "info",
] as const;
const EXPIRIES = [
  { value: "250926", label: "25 Sep · 19d" },
  { value: "261226", label: "26 Dec · 110d" },
  { value: "270326", label: "27 Mar · 201d", disabled: true },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-section={id} className="flex flex-col gap-3">
      <h3 className="micro">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** One column of every component; `theme` is the class scope so both themes render on one page. */
function Panel({ theme, compact }: { theme: "light" | "dark"; compact: boolean }) {
  const [expiry, setExpiry] = useState("250926");
  const [live, setLive] = useState(false);
  const id = (s: string) => `${theme}-${s}`;

  return (
    <div
      data-theme={theme}
      data-density={compact ? "compact" : "comfortable"}
      className={cn(theme, compact && "compact", "flex flex-col gap-8 bg-background p-6 text-foreground")}
    >
      <h2 className="font-display text-xl">{theme === "dark" ? "Dark" : "Light"}</h2>

      <Section id={id("buttons")} title="Button · variant × size · loading / disabled">
        {BUTTON_VARIANTS.map((variant) => (
          <Row key={variant}>
            {BUTTON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {variant} {size}
              </Button>
            ))}
            <Button variant={variant} loading>
              loading
            </Button>
            <Button variant={variant} disabled>
              disabled
            </Button>
          </Row>
        ))}
      </Section>

      <Section id={id("badges")} title="Badge">
        <Row>
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </Row>
      </Section>

      <Section id={id("forms")} title="Input · Select · Textarea · Field · Label">
        <div className="grid max-w-md gap-1">
          <Field label="Quantity (lots)" hint="1 lot = 0.001 BTC" required id={id("qty")}>
            <Input numeric placeholder="0" defaultValue="3" />
          </Field>
          <Field label="Limit price (USD)" error="Must be above the best bid" id={id("px")}>
            <Input numeric defaultValue="79521.5" />
          </Field>
          <Field label="Expiry" id={id("expiry")}>
            {(control) => (
              <Select
                options={EXPIRIES}
                value={expiry}
                onValueChange={setExpiry}
                placeholder="Pick an expiry"
                {...control}
              />
            )}
          </Field>
          <Field label="Notes" hint="Optional, shown in the journal" id={id("notes")}>
            <Textarea placeholder="Why this trade?" />
          </Field>
          <Row>
            <Input size="sm" placeholder="Small input" aria-label="Small input" className="w-40" />
            <Select
              options={EXPIRIES}
              size="sm"
              placeholder="Small select"
              aria-label="Small select"
              className="w-40"
            />
            <Input disabled placeholder="Disabled" aria-label="Disabled input" className="w-40" />
          </Row>
        </div>
      </Section>

      <Section id={id("tabs")} title="Tabs · line / segmented">
        <Tabs defaultValue="payoff" variant="line">
          <TabsList aria-label="Analysis">
            <TabsTrigger value="payoff">Payoff</TabsTrigger>
            <TabsTrigger value="greeks">Greeks</TabsTrigger>
            <TabsTrigger value="vol">Vol</TabsTrigger>
          </TabsList>
          <TabsContent value="payoff">Payoff at expiry and on the target date.</TabsContent>
          <TabsContent value="greeks">Net delta, gamma, theta, vega.</TabsContent>
          <TabsContent value="vol">Mark IV by strike.</TabsContent>
        </Tabs>
        <Tabs defaultValue="chain" variant="segmented">
          <TabsList aria-label="Workspace">
            <TabsTrigger value="chain">Chain</TabsTrigger>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="paper">Paper</TabsTrigger>
          </TabsList>
          <TabsContent value="chain">Option chain</TabsContent>
          <TabsContent value="builder">Strategy builder</TabsContent>
          <TabsContent value="paper">Paper trades</TabsContent>
        </Tabs>
      </Section>

      <Section id={id("controls")} title="Switch · Checkbox · Kbd · Tooltip · Spinner">
        <Row>
          <Switch id={id("live")} checked={live} onCheckedChange={setLive} />
          <Label htmlFor={id("live")} className="mb-0">
            Live feed {live ? "on" : "off"}
          </Label>
          <Checkbox id={id("agree")} defaultChecked />
          <Label htmlFor={id("agree")} className="mb-0">
            Include fees
          </Label>
          <Checkbox id={id("mixed")} checked="indeterminate" aria-label="Some legs selected" />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
          <TooltipProvider>
            <Tooltip content="Add a buy leg at this strike">
              <Button size="sm" variant="outline">
                Hover me
              </Button>
            </Tooltip>
          </TooltipProvider>
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </Row>
      </Section>

      <Section id={id("dialog-toast")} title="Dialog · Toast">
        <Row>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent size="sm" className={theme}>
              <DialogHeader>
                <DialogTitle>Close 2 positions?</DialogTitle>
                <DialogDescription>
                  Market orders at the current mark. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Stat label="Net P&amp;L" value="+$0.18" sub="mark · USD" tone="profit" />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant="sell">Close positions</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            onClick={() => toast.success("Order placed", { description: "C-BTC-80000-250926 · 3 lots" })}
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error("Order rejected", { description: "Insufficient margin" })}
          >
            Error toast
          </Button>
        </Row>
      </Section>

      <Section id={id("table")} title="Table · numeric cells · row height follows density">
        <Table compact={compact}>
          <THead>
            <Tr>
              <Th>Symbol</Th>
              <Th numeric>Mark</Th>
              <Th numeric>IV</Th>
              <Th numeric>Δ</Th>
              <Th>Side</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Td>C-BTC-80000-250926</Td>
              <Td numeric>2,811.8</Td>
              <Td numeric>41.9%</Td>
              <Td numeric>0.49</Td>
              <Td>
                <Badge variant="buy">BUY</Badge>
              </Td>
            </Tr>
            <Tr>
              <Td>P-BTC-79000-250926</Td>
              <Td numeric>2,818.7</Td>
              <Td numeric>42.5%</Td>
              <Td numeric>-0.45</Td>
              <Td>
                <Badge variant="sell">SELL</Badge>
              </Td>
            </Tr>
          </TBody>
        </Table>
      </Section>

      <Section id={id("stats")} title="Stat">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Max profit" value="$1,240" sub="at expiry" tone="profit" />
          <Stat label="Max loss" value="-$860" sub="at expiry" tone="loss" />
          <Stat label="Net premium" value="$380" sub="mark · USD" />
          <Stat label="Spot" value="79,521.5" sub="BTCUSD · Delta" tone="spot" />
        </div>
      </Section>

      <Section id={id("empty")} title="EmptyState">
        <EmptyState
          icon={<Inbox />}
          title="No strategy yet"
          description="Hover a chain row and press B / S, or load a template from the Builder."
          action={
            <Button size="sm" variant="secondary">
              Open Builder
            </Button>
          }
        />
      </Section>
    </div>
  );
}

export interface PreviewProps {
  /** Render both panels with compact rows (28px). */
  compact?: boolean;
}

/** Every component, light and dark side by side. Mount inside the app's providers or standalone. */
export function Preview({ compact = false }: PreviewProps) {
  return (
    <main data-preview className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <h1 className="sr-only">HapieCoin UI preview</h1>
      <Panel theme="light" compact={compact} />
      <Panel theme="dark" compact={compact} />
      <Toaster />
    </main>
  );
}

export default Preview;
