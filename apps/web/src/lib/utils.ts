import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's className join. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
