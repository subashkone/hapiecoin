// @hapiecoin/ui public API. CSS entry points: "@hapiecoin/ui/fonts.css", "@hapiecoin/ui/theme.css".
export { cn } from "./lib/cn";
export * from "./tokens";
export * from "./icons";

export { Badge, badgeVariants, type BadgeProps } from "./components/Badge";
export { Button, buttonVariants, type ButtonProps } from "./components/Button";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogContentVariants,
  type DialogContentProps,
} from "./components/Dialog";
export { EmptyState, type EmptyStateProps } from "./components/EmptyState";
export { Field, type FieldControlProps, type FieldProps } from "./components/Field";
export { Input, controlVariants, type InputProps } from "./components/Input";
export { Kbd, type KbdProps } from "./components/Kbd";
export { Label, type LabelProps } from "./components/Label";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectRoot,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectOption,
  type SelectProps,
  type SelectTriggerProps,
} from "./components/Select";
export { Spinner, spinnerVariants, type SpinnerProps } from "./components/Spinner";
export { Stat, statValueVariants, type StatProps } from "./components/Stat";
export { Switch, type SwitchProps } from "./components/Switch";
export { TBody, TFoot, THead, Table, Td, Th, Tr, type CellProps, type TableProps } from "./components/Table";
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TabsProps,
  type TabsVariant,
} from "./components/Tabs";
export { Textarea, type TextareaProps } from "./components/Textarea";
export { Toaster, toast, type ToasterProps } from "./components/Toaster";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  type TooltipProps,
} from "./components/Tooltip";

export {
  DensityProvider,
  DENSITY_STORAGE_KEY,
  applyDensity,
  useDensity,
  type Density,
  type DensityContextValue,
  type DensityProviderProps,
} from "./providers/DensityProvider";
export {
  ThemeProvider,
  THEME_STORAGE_KEY,
  applyTheme,
  themeInitScript,
  useOptionalTheme,
  useTheme,
  type ResolvedTheme,
  type Theme,
  type ThemeContextValue,
  type ThemeProviderProps,
} from "./providers/ThemeProvider";

/** Path (relative to the package root) of the self-hosted font declarations, for bundler-agnostic consumers. */
export const fontsCss = "@hapiecoin/ui/fonts.css";
/** Path of the Tailwind v4 theme (imports tokens.css). */
export const themeCss = "@hapiecoin/ui/theme.css";
