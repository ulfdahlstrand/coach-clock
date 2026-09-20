/*
 * shadcn-CLI:t skriver numera `import { cn } from 'cn'` i komponenterna det lägger
 * till — `cn` är shadcn-ui:s egna paket och har ersatt clsx + tailwind-merge.
 * Vi behåller den här modulen som components.json:s `utils`-alias och som enda
 * ställe att byta implementation på, och låter egen kod importera härifrån.
 */
export { cn } from 'cn';
