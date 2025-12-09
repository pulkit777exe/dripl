export const designTokens = {
  radius: {
    sm: 'rounded-lg',
    md: 'rounded-xl',     
    lg: 'rounded-2xl',    
  },
  
  // Spacing
  spacing: {
    xs: 'gap-1',   // 4px
    sm: 'gap-2',   // 8px
    md: 'gap-3',   // 12px
    lg: 'gap-4',   // 16px
  },
  
  // Padding
  padding: {
    sm: 'p-2',     // 8px
    md: 'p-3',     // 12px
    lg: 'p-4',     // 16px
  },
  
  // Standardized Shadows
  shadow: {
    sm: 'shadow-sm',      // Subtle
    md: 'shadow-md',      // Medium
    lg: 'shadow-[0_8px_30px_rgb(0,0,0,0.12)]',  // Premium floating
  },
  
  // Backgrounds (glassmorphism)
  bg: {
    primary: 'bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md',
    secondary: 'bg-neutral-50/80 dark:bg-neutral-800/80 backdrop-blur-sm',
  },
  
  // Icon sizes
  icon: {
    sm: 'size-4',  // 16px
    md: 'size-5',  // 20px
    lg: 'size-6',  // 24px
  },
} as const;
