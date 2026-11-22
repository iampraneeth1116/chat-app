import { StyleSheet, Text, View } from 'react-native';
import { avatarColor } from './theme';

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const label = name.trim();
  const parts = label.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : (label[0] ?? '?').toUpperCase();

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor(label || '?'),
        },
      ]}>
      <Text style={[styles.text, { fontSize: Math.round(size * 0.38) }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
