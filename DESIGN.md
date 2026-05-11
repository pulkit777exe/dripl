# Design

## Visual Theme
Warm, approachable, collaborative. A calm workspace for visual thinking with hand-drawn aesthetic. The design embraces warmth over coldness, creating an inviting environment for teams to collaborate on ideas.

## Color Palette

### Primary Colors
- **Background**: `#F0EDE6` (warm cream) - The foundation, creates a calm, paper-like surface
- **Card**: `#FAFAF7` (off-white) - Slightly lighter than background for depth
- **Foreground**: `#1A1917` (deep charcoal) - Primary text and UI elements
- **Primary**: `#E8462A` (warm orange) - Accent color for actions and highlights

### Semantic Colors
- **Secondary**: `#E8E5DE` (warm gray) - Secondary backgrounds and borders
- **Muted**: `#E8E5DE` (warm gray) - De-emphasized content
- **Muted Foreground**: `#6B6860` (warm gray) - Secondary text
- **Accent**: `#FAE8E5` (light orange) - Subtle highlights and active states
- **Destructive**: `#C0392B` (red) - Error states and destructive actions
- **Border**: `#D4D0C9` (warm gray) - Borders and dividers

### Canvas-Specific Colors
- **Toolbar Background**: `#F0EDE6` (matches main background)
- **Toolbar Border**: `#E4E0D9` (slightly darker than border)
- **Tool Active Background**: `#FAE8E5` (light orange)
- **Tool Active Text**: `#E8462A` (primary orange)
- **Tool Active Shadow**: `rgba(232, 70, 42, 0.2)` (subtle orange glow)
- **Tool Inactive Text**: `#6B6860` (muted foreground)
- **Tool Hover Background**: `#E8E5DE` (secondary)
- **Tool Hover Text**: `#1A1917` (foreground)

### Panel Colors
- **Panel Background**: `#FAFAF7` (card)
- **Panel Border**: `#E4E0D9` (toolbar border)
- **Panel Button Background**: `#E8E5DE` (secondary)
- **Panel Button Hover**: `#D4D0C9` (border)
- **Panel Button Active**: `#E8462A` (primary)
- **Panel Button Active Text**: `#ffffff` (white)
- **Panel Label**: `#6B6860` (muted foreground)
- **Panel Text**: `#1A1917` (foreground)
- **Panel Divider**: `#E4E0D9` (toolbar border)
- **Panel Slider**: `#D4D0C9` (border)
- **Panel Menu Active**: `#FAE8E5` (accent)

### Dark Mode
- **Background**: `#1C1A17` (dark charcoal)
- **Card**: `#2C2A25` (dark gray)
- **Foreground**: `#F0EDE6` (warm cream)
- **Primary**: `#E8462A` (same orange - consistent across themes)
- **Border**: `#3A3830` (darker gray)
- **Muted Foreground**: `#9B9890` (lighter gray)
- **Tool Active Text**: `#FAC8BE` (light orange)
- **Tool Active Shadow**: `rgba(232, 70, 42, 0.25)` (slightly stronger glow)

## Typography

### Font Families
- **UI Font**: Inter (with system-ui fallback)
  - Variable: `--font-ui`
  - Fallback: `ui-sans-serif, system-ui, sans-serif`
  - Used for: All interface text, buttons, labels, forms

- **Handwritten Font**: Caveat
  - Variable: `--font-handwritten`
  - Fallback: `'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', 'Comic Neue', cursive`
  - Used for: Canvas text elements, handwritten-style content

### Type Scale
The typography uses Inter's natural scale with these common sizes:
- **Body**: 13-15px (base text)
- **Small**: 11-12px (labels, metadata)
- **Heading**: 24-40px (page titles, section headers)
- **Large**: 48-56px (hero text)

### Font Weights
- **Regular**: 400 (body text)
- **Medium**: 500 (emphasis, buttons)
- **Semibold**: 600 (headings, important text)

## Components

### Buttons

#### Primary Button
- Background: Primary color (`#E8462A`)
- Text: White
- Border: 1px solid with 50% opacity primary
- Shadow: `0 10px 22px rgba(232, 70, 42, 0.24)` with inner highlight
- Hover: Brightness filter to 0.98, enhanced shadow
- Border Radius: 0.75rem (12px)

#### Secondary Button
- Background: White or card color
- Text: Foreground color
- Border: 1px solid border color
- Hover: Background changes to secondary color
- Shadow: Button shadow scale

#### Icon Button
- Padding: 0.5rem (8px)
- Border Radius: 0.5rem (8px)
- Active State: Tool active background and text colors
- Hover State: Tool hover background and text colors
- Transition: Color changes only

#### Canvas Chrome Button
- Border Radius: 0.75rem (12px)
- Border: 1px solid toolbar border
- Background: Toolbar background
- Shadow: Canvas chrome shadow with backdrop blur
- Backdrop Filter: 8px blur
- Transition: Background, border, color, shadow (0.15s ease)

### Cards

#### Glass Card
- Border: 1px solid border color
- Background: Card color
- Shadow: `0 1px 3px rgba(0, 0, 0, 0.06)`
- Dark Mode Shadow: `0 1px 3px rgba(0, 0, 0, 0.12)`

#### Canvas Chrome Group
- Background: Toolbar background
- Border: 1px solid toolbar border
- Shadow: Canvas chrome shadow
- Backdrop Filter: 8px blur

### Forms

#### Text Input
- Background: White
- Border: 1px solid border color (`#D4D0C9`)
- Padding: 0.5rem 0.75rem
- Font Size: 14px
- Text Color: Foreground
- Placeholder Color: Muted foreground
- Focus: Border changes to primary, ring appears
- Focus Ring: 1px primary with 20% opacity

#### Range Slider
- Height: 4px
- Border Radius: 2px
- Background: Panel slider color
- Thumb Size: 14px × 14px
- Thumb Border Radius: 50%
- Thumb Background: Primary color
- Thumb Border: 2px solid panel background
- Thumb Shadow: 1px primary color
- Thumb Hover: Scale to 1.2

### Panels

#### Properties Panel
- Background: Panel background
- Border: 1px solid panel border
- Width: 12rem (192px)
- Border Radius: 0.75rem (12px)
- Shadow: Canvas chrome shadow
- Animation: Slide in from left with opacity (0.2s cubic-bezier)
- Transform: -12px offset when hidden

#### Sidebar Panel
- Animation: Slide in from left with opacity (0.18s cubic-bezier)
- Transform: -8px offset when hidden

### Modals

#### Modal Overlay
- Background: `rgba(0, 0, 0, 0.3)` with backdrop blur
- Animation: Fade in (0.2s)
- Z-Index: 300-400 (varies by modal type)

#### Modal Content
- Background: Card color
- Border: 1px solid border color
- Border Radius: 0.75rem (12px)
- Shadow: Large shadow
- Animation: Zoom in with slide (0.3s)
- Max Width: 440px (standard), 4xl (command palette)

## Layout

### Spacing Scale
- **Extra Small**: 0.25rem (4px)
- **Small**: 0.5rem (8px)
- **Medium**: 1rem (16px)
- **Large**: 1.5rem (24px)
- **Extra Large**: 2rem (32px)

### Container System
- **Center**: True (centers content)
- **Padding**: 2rem (32px)
- **Max Width**: 1400px (2xl breakpoint)

### Responsive Breakpoints
- **Mobile**: Default (< 640px)
- **Tablet**: `md` (≥ 768px)
- **Desktop**: `lg` (≥ 1024px)
- **Large Desktop**: `xl` (≥ 1280px)
- **Extra Large**: `2xl` (≥ 1400px)

### Grid Patterns
- **File Browser**: Responsive grid (2-6 columns based on screen size)
- **Features**: 2-3 columns with gap
- **Toolbar**: Horizontal flex with gap

## Motion

### Transitions

#### Standard Transitions
- **Color/Background**: 0.15s ease
- **Transform**: 0.1s ease-out
- **Opacity**: 0.18s ease-out (panels), 0.2s ease-out (properties)

#### Button Transitions
- **Smooth Button**: Background, color, shadow (0.15s ease-out), transform (0.1s ease-out)
- **Hover**: Translate Y -1px
- **Active**: Translate Y 0, scale 0.97

#### Canvas Transitions
- **Selection Box**: None (instant), animate mode (0.08s linear)
- **Resize Handle**: Transform, shadow (0.1s ease-out)
- **Rotate Handle**: Transform, shadow (0.1s ease-out)
- **Zoom**: Transform (0.1s ease-out)

### Animations

#### Panel Animations
- **Sidebar Panel**: Transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.18s ease-out
- **Properties Panel**: Transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.2s ease-out

#### Modal Animations
- **Overlay**: Fade in (0.2s)
- **Content**: Zoom in 95% with slide from bottom (0.3s)

#### Hover Effects
- **Resize Handle**: Scale 1.2, shadow expansion
- **Rotate Handle**: Scale 1.35, shadow expansion
- **Range Slider Thumb**: Scale 1.2

## Elevation & Shadows

### Shadow Scale
- **Extra Small**: `0 1px 2px rgba(0, 0, 0, 0.04)`
- **Small**: `0 1px 3px rgba(0, 0, 0, 0.06)`
- **Medium**: `0 4px 12px rgba(0, 0, 0, 0.06)`
- **Large**: `0 8px 24px rgba(0, 0, 0, 0.08)`
- **Inner**: `inset 0 1px 2px rgba(0, 0, 0, 0.04)`

### Component-Specific Shadows
- **Button**: `0 1px 2px rgba(0, 0, 0, 0.04)`
- **Button Hover**: `0 1px 3px rgba(0, 0, 0, 0.06)`
- **Card**: `0 1px 3px rgba(0, 0, 0, 0.06)`
- **Canvas Chrome**: `0 8px 22px rgba(22, 18, 12, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.58)`
- **Primary Button**: `0 10px 22px rgba(232, 70, 42, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.2)`

### Dark Mode Shadows
- **Extra Small**: `0 1px 2px rgba(0, 0, 0, 0.2)`
- **Small**: `0 1px 3px rgba(0, 0, 0, 0.25)`
- **Medium**: `0 4px 12px rgba(0, 0, 0, 0.2)`
- **Large**: `0 8px 24px rgba(0, 0, 0, 0.25)`
- **Inner**: `inset 0 1px 2px rgba(0, 0, 0, 0.2)`
- **Canvas Chrome**: `0 10px 28px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.1)`

## Border Radius

### Radius Scale
- **Base**: 0.5rem (8px)
- **Large**: 0.5rem (8px) - uses base
- **Medium**: 0.375rem (6px) - base - 2px
- **Small**: 0.25rem (4px) - base - 4px

### Component-Specific Radius
- **Buttons**: 0.75rem (12px)
- **Cards**: 0.75rem (12px)
- **Inputs**: 0.375rem (6px)
- **Icon Buttons**: 0.5rem (8px)
- **Resize Handles**: 3px

## Scrollbars

### Custom Scrollbar
- **Width**: 6px
- **Height**: 6px
- **Track**: Transparent
- **Thumb**: Border color with 3px border radius
- **Thumb Hover**: Muted foreground color

## Backdrop Filters

### Blur Effects
- **Canvas Chrome**: 8px blur
- **Canvas Chrome Group**: 8px blur
- **Canvas Chrome Button**: 8px blur
- **Modal Overlay**: Backdrop blur (varies by implementation)

## Grid Patterns

### Background Grid
- **Pattern**: Linear gradients creating grid lines
- **Color**: Border color with 40% opacity
- **Size**: 32px × 32px (from existing implementation)
- **Usage**: Canvas background for alignment reference