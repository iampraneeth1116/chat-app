import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from './api';
import { colors } from './theme';

export const SERVER_URL_STORAGE_KEY = 'server_url';

type LayoutProps = {
  title: string;
  subtitle: string;
  footerPrompt: string;
  footerAction: string;
  onFooterPress: () => void;
  disabled?: boolean;
  children: ReactNode;
};

export function AuthLayout({
  title,
  subtitle,
  footerPrompt,
  footerAction,
  onFooterPress,
  disabled,
  children,
}: LayoutProps) {
  const [editingServer, setEditingServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(() => getBaseUrl());
  const [activeUrl, setActiveUrl] = useState(() => getBaseUrl());

  const openServerModal = () => {
    setServerDraft(getBaseUrl());
    setEditingServer(true);
  };

  const saveServer = async () => {
    const trimmed = serverDraft.trim().replace(/\/+$/, '');
    if (trimmed) {
      setBaseUrl(trimmed);
      setActiveUrl(trimmed);
      await AsyncStorage.setItem(SERVER_URL_STORAGE_KEY, trimmed).catch(() => {});
    }
    setEditingServer(false);
  };

  const resetServer = async () => {
    setBaseUrl(DEFAULT_BASE_URL);
    setActiveUrl(DEFAULT_BASE_URL);
    setServerDraft(DEFAULT_BASE_URL);
    await AsyncStorage.removeItem(SERVER_URL_STORAGE_KEY).catch(() => {});
    setEditingServer(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brandBlock}>
            <View style={styles.logoBox}>
              <Ionicons name="chatbubble-ellipses" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>{subtitle}</Text>
          </View>

          <View style={styles.card}>{children}</View>

          <View style={styles.footer}>
            <Text style={styles.footerPrompt}>{footerPrompt} </Text>
            <Pressable onPress={onFooterPress} disabled={disabled} hitSlop={8}>
              <Text style={styles.footerAction}>{footerAction}</Text>
            </Pressable>
          </View>

          <Pressable style={styles.serverPill} onPress={openServerModal} disabled={disabled} hitSlop={8}>
            <Ionicons name="server-outline" size={14} color={colors.subtext} />
            <Text style={styles.serverPillText} numberOfLines={1}>
              {activeUrl}
            </Text>
            <Ionicons name="pencil-outline" size={13} color={colors.muted} />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={editingServer} transparent animationType="fade" onRequestClose={() => setEditingServer(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Backend Server URL</Text>
            <Text style={styles.modalSub}>
              Enter the local URL where your backend server is running (e.g. http://10.7.30.34:3000).
            </Text>
            <View style={styles.inputWrap}>
              <Ionicons name="globe-outline" size={18} color={colors.subtext} />
              <TextInput
                style={styles.input}
                value={serverDraft}
                onChangeText={setServerDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={DEFAULT_BASE_URL}
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable onPress={resetServer} hitSlop={8}>
                <Text style={styles.resetText}>Reset default</Text>
              </Pressable>
              <View style={styles.modalButtons}>
                <Pressable style={styles.cancelBtn} onPress={() => setEditingServer(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.saveBtn} onPress={saveServer}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  inputRef?: React.Ref<TextInputInstance>;
  isPassword?: boolean;
  optional?: boolean;
};

export function AuthField({ label, icon, inputRef, isPassword, optional, ...props }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!isPassword);

  return (
    <View style={styles.fieldGroup}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {optional && <Text style={styles.optionalTag}>Optional</Text>}
      </View>
      <View style={[styles.inputWrap, focused && styles.inputFocused]}>
        <Ionicons name={icon} size={18} color={colors.subtext} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={isPassword ? hidden : props.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />
        {isPassword && (
          <Pressable
            onPress={() => setHidden((v) => !v)}
            hitSlop={8}
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color={colors.subtext} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle-outline" size={17} color={colors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function AuthSubmitButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      onPress={onPress}
      disabled={disabled}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  sub: {
    color: colors.subtext,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 300,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  optionalTag: {
    fontSize: 12,
    color: colors.muted,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
  },
  inputFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 8,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonPressed: {
    backgroundColor: colors.accentPressed,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 22,
  },
  footerPrompt: {
    fontSize: 14,
    color: colors.subtext,
  },
  footerAction: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.brand,
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '90%',
  },
  serverPillText: {
    fontSize: 12,
    color: colors.subtext,
    flexShrink: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 13,
    color: colors.subtext,
    lineHeight: 18,
    marginBottom: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  resetText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.subtext,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.brand,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
