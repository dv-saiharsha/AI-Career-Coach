import { forwardRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useTheme, space, radius, type, elevation, HIT_SLOP_MIN } from '@/theme'

/**
 * The primitives every screen is built from.
 *
 * Depth is a surface step, a hairline and a shallow shadow — the same three
 * things, in the same order, as the web card. Under the neumorphic system
 * this file could only do the first of those, because two-sided shadows are
 * not expressible in React Native; the flat rebuild removed that gap rather
 * than working around it.
 *
 * Every pressable floors at 44pt. It is enforced here rather than left to
 * each screen, because a touch target is exactly the kind of thing that is
 * correct on the day it is written and wrong three screens later.
 */

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme()
  return <View style={[{ flex: 1, backgroundColor: colors.canvas }, style]}>{children}</View>
}

export function Card({
  children,
  style,
  elevated,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  elevated?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: elevated ? colors.canvasElevated : colors.canvasRaise,
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: colors.line,
          padding: space.lg,
          /* Surface step, then hairline, then shadow — the same order of
             importance as the web card. The shadow is the refinement, not
             the thing that makes the card readable. */
          ...elevation.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

type TextVariant = keyof typeof type
type ColorKey =
  | 'ink'
  | 'inkSubtle'
  | 'inkMuted'
  | 'inkFaint'
  | 'accentText'
  | 'signal'
  | 'onAccent'
  | 'danger'
  | 'success'
  | 'warning'

export function Txt({
  children,
  variant = 'body',
  color = 'ink',
  style,
  numberOfLines,
}: {
  children: ReactNode
  variant?: TextVariant
  color?: ColorKey
  style?: object
  numberOfLines?: number
}) {
  const { colors } = useTheme()
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[type[variant] as object, { color: colors[color] }, style]}
    >
      {children}
    </Text>
  )
}

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode
  variant?: 'primary' | 'quiet' | 'ghost'
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

export function Button({
  children,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme()
  const isDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          minHeight: HIT_SLOP_MIN,
          borderRadius: radius.lg,
          paddingHorizontal: space.xl,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          backgroundColor:
            variant === 'primary'
              ? colors.accent
              : variant === 'quiet'
                ? colors.canvasElevated
                : 'transparent',
          /* Pressed state is opacity rather than scale: a button that shrinks
             under the thumb it is already under reads as slipping away. */
          opacity: isDisabled ? 0.5 : pressed ? 0.82 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.onAccent : colors.ink}
        />
      )}
      <Txt
        variant="body"
        color={variant === 'primary' ? 'onAccent' : 'ink'}
        style={{ fontWeight: '500' }}
      >
        {children}
      </Txt>
    </Pressable>
  )
}

interface FieldProps extends TextInputProps {
  label: string
  error?: string | null
  /** Rendered before the input, e.g. a status line the field describes. */
  hint?: string
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, style, ...rest },
  ref,
) {
  const { colors } = useTheme()
  const describedBy = [hint, error].filter(Boolean).join('. ')

  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="label" color="inkSubtle">
        {label}
      </Txt>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={describedBy || undefined}
        placeholderTextColor={colors.inkFaint}
        style={[
          {
            minHeight: HIT_SLOP_MIN,
            backgroundColor: colors.canvas,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.line,
            paddingHorizontal: space.md,
            color: colors.ink,
            fontSize: type.body.fontSize,
          },
          style,
        ]}
        {...rest}
      />
      {hint && !error && (
        <Txt variant="bodySm" color="inkFaint">
          {hint}
        </Txt>
      )}
      {error && (
        <Txt variant="bodySm" color="danger">
          {error}
        </Txt>
      )}
    </View>
  )
})

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected?: boolean
  onPress?: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      /* The chip is visually small; hitSlop makes the target 44pt without
         making the pill itself look like a button. */
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        backgroundColor: selected ? colors.accent : colors.canvasRaise,
        borderWidth: 1,
        borderColor: selected ? 'transparent' : colors.line,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Txt variant="label" color={selected ? 'onAccent' : 'inkMuted'}>
        {label}
      </Txt>
    </Pressable>
  )
}

export const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
})
