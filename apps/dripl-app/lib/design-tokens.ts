export const designTokens = {
  radius: {
    sm: 'rounded-lg',
    md: 'rounded-xl',     
    lg: 'rounded-2xl',    
  },
  
  spacing: {
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4',
  },
  
  padding: {
    sm: 'p-2',
    md: 'p-3',
    lg: 'p-4',
  },
  
  shadow: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-[0_8px_30px_rgb(0,0,0,0.12)]',
  },
  
  bg: {
    primary: 'bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md',
    secondary: 'bg-neutral-50/80 dark:bg-neutral-800/80 backdrop-blur-sm',
  },
  
  icon: {
    sm: 'size-4',
    md: 'size-5',
    lg: 'size-6',
  },
} as const;
