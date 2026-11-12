// Small pieces shared by the game screens: the round top bar, a member chip
// with avatar, the team badge, and name/avatar lookup for household members.
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ChevronLeft, DoorOpen, Volume2, VolumeX } from "lucide-react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Pressable } from "@/components/Pressable";
import { Btn, Txt } from "@/components/ui";
import { GradientBox } from "@/components/home/GradientBox";
import { Avatar } from "@/apps/family/Avatar";
import { useI18n } from "@/hooks/useI18n";
import type { Team } from "@/lib/games";
import { fonts, sp, useTheme } from "@/theme/theme";
import { isMuted, setMuted } from "./feedback";
import { GAME_ACTION, TEAM_GRADIENT, TEAM_SOLID } from "./look";

export function GameTopBar({
  title,
  onBack,
  right,
  exitLabel,
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  exitLabel?: string;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [muted, setM] = useState(isMuted());
  const back =
    onBack ??
    (() => (router.canGoBack() ? router.back() : router.replace("/games")));
  return (
    <View style={styles.topBar}>
      {/* Equal-width sides keep the title centred on the screen whatever the
          left pill says ("Sair da sala" pushed it right — owner, 2026-11). */}
      <View style={styles.topSide}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={back}
          hitSlop={8}
          style={[
            exitLabel ? styles.exitPill : styles.round,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          {exitLabel ? (
            <>
              {/* a plain chevron: the mirrored LogOut icon rendered as a dark
                smudge in dark mode */}
              <ChevronLeft size={19} color={c.text} strokeWidth={2.4} />
              <Txt
                style={{
                  fontFamily: fonts.semibold,
                  fontSize: 14,
                  color: c.text,
                }}
                numberOfLines={1}
              >
                {exitLabel}
              </Txt>
            </>
          ) : (
            <ChevronLeft size={22} color={c.text} />
          )}
        </Pressable>
      </View>
      <Txt
        style={{
          flexShrink: 1,
          fontFamily: fonts.semibold,
          fontSize: 16,
          textAlign: "center",
          color: c.text,
        }}
        numberOfLines={1}
      >
        {title ?? ""}
      </Txt>
      <View style={[styles.topSide, { justifyContent: "flex-end" }]}>
        {right}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(muted ? "games.soundOn" : "games.soundOff")}
          onPress={() => {
            setMuted(!muted);
            setM(!muted);
          }}
          hitSlop={8}
          style={[
            styles.round,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          {muted ? (
            <VolumeX size={20} color={c.textMuted} />
          ) : (
            <Volume2 size={20} color={c.text} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

export function MemberChip({
  email,
  label,
  avatarPath,
  trailing,
  dim,
  highlight,
}: {
  email: string;
  label: string;
  avatarPath: string | null;
  trailing?: React.ReactNode;
  dim?: boolean;
  highlight?: string;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: c.card,
          borderColor: highlight ?? c.border,
          opacity: dim ? 0.45 : 1,
        },
        highlight ? { borderWidth: 2 } : null,
      ]}
      accessibilityLabel={label}
      key={email}
    >
      <Avatar name={label} avatarPath={avatarPath} size={34} />
      <Txt
        style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15 }}
        numberOfLines={1}
      >
        {label}
      </Txt>
      {trailing}
    </View>
  );
}

/** A team's score tile. `mine` gets a "You" tag and full colour; the other
 *  team's tile is faded (`dim`) so your own team always stands out. */
export function TeamBadge({
  team,
  label,
  score,
  big,
  mine,
  dim,
}: {
  team: Team;
  label: string;
  score?: number;
  big?: boolean;
  mine?: boolean;
  dim?: boolean;
}) {
  const { t } = useI18n();
  return (
    <View style={[big ? { flex: 1 } : null, { opacity: dim ? 0.42 : 1 }]}>
      <GradientBox
        colors={TEAM_GRADIENT[team]}
        radius={big ? 22 : 999}
        style={big ? styles.badgeBig : styles.badge}
      >
        {/* big tiles always keep the tag's row (invisible when it isn't
            yours) so both teams' tiles are the same height */}
        {mine || big ? (
          <View
            style={[
              styles.youTag,
              big ? null : { marginRight: 2 },
              !mine && { opacity: 0 },
            ]}
          >
            <Txt
              style={{
                color: "#fff",
                fontFamily: fonts.semibold,
                fontSize: 11,
                letterSpacing: 0.6,
              }}
            >
              {t("games.you").toUpperCase()}
            </Txt>
          </View>
        ) : null}
        <Txt
          style={{
            color: "#fff",
            fontFamily: fonts.semibold,
            fontSize: big ? 14 : 13,
          }}
          numberOfLines={1}
        >
          {label}
        </Txt>
        {score !== undefined ? (
          <Txt
            style={{
              color: "#fff",
              fontFamily: fonts.display,
              fontSize: big ? 30 : 16,
              lineHeight: big ? 34 : 20,
            }}
          >
            {score}
          </Txt>
        ) : null}
      </GradientBox>
    </View>
  );
}

/** "You're on Team Orange" — a slim gradient strip at the top of every game
 *  screen, so nobody forgets which side they're on. */
export function MyTeamBanner({ team }: { team: Team }) {
  const { t } = useI18n();
  return (
    <GradientBox
      colors={TEAM_GRADIENT[team]}
      radius={999}
      style={styles.banner}
    >
      <View style={styles.bannerDot} />
      <Txt style={{ color: "#fff", fontFamily: fonts.semibold, fontSize: 14 }}>
        {t("games.myTeam", { team: t(`games.team.${team}`) })}
      </Txt>
    </GradientBox>
  );
}

/** A soft glow of your team's colour washing down from the very top of the
 *  screen — drawn ONCE by Room behind the status bar and the top bar, so there
 *  is no seam where the header ends (owner, 2026-11). */
export function TeamWash({ team }: { team: Team | undefined }) {
  if (!team) return null;
  const color = TEAM_SOLID[team];
  return (
    <View pointerEvents="none" style={styles.wash}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`wash${team}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.22} />
            <Stop offset="0.45" stopColor={color} stopOpacity={0.1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#wash${team})`} />
      </Svg>
    </View>
  );
}

/** The games' own confirm dialog (owner, 2026-11: the system alert looked
 *  "bem Android"): a card on a dimmed backdrop, a door tile, title + line,
 *  the action as a red game button and "stay" as the quiet one. */
export function LeaveSheet({
  visible,
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.cancel")}
        onPress={onClose}
        style={styles.leaveBackdrop}
      >
        <Pressable
          onPress={() => undefined}
          style={[styles.leaveCard, { backgroundColor: c.sheet }]}
        >
          <GradientBox
            colors={LEAVE_GRADIENT}
            radius={22}
            style={styles.leaveIcon}
          >
            <DoorOpen size={30} color="#fff" strokeWidth={2} />
          </GradientBox>
          <Txt
            style={{
              fontFamily: fonts.display,
              fontSize: 24,
              textAlign: "center",
              lineHeight: 30,
            }}
          >
            {title}
          </Txt>
          <Txt
            variant="muted"
            style={{ textAlign: "center", fontSize: 15, lineHeight: 21 }}
          >
            {body}
          </Txt>
          <View style={{ alignSelf: "stretch", gap: sp.sm, marginTop: sp.sm }}>
            <GameBtn
              title={confirm}
              colors={LEAVE_GRADIENT}
              onPress={onConfirm}
            />
            <GameBtn
              title={t("games.stay")}
              variant="secondary"
              onPress={onClose}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const LEAVE_GRADIENT: readonly [string, string] = ["#FF8F86", "#E04A63"];

const styles = StyleSheet.create({
  exitPill: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 10,
    paddingRight: 14,
    flexShrink: 1,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leaveBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: sp.lg,
  },
  leaveCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 30,
    padding: sp.lg,
    paddingTop: sp.xl,
    alignItems: "center",
    gap: sp.sm,
  },
  leaveIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: sp.xs,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: sp.sm,
    paddingVertical: sp.sm,
  },
  topSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: sp.sm },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: sp.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeBig: {
    alignItems: "center",
    paddingVertical: sp.md,
    paddingHorizontal: sp.md,
    gap: 2,
  },
  youTag: {
    backgroundColor: "rgba(255,255,255,0.28)",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 2,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  wash: { position: "absolute", top: 0, left: 0, right: 0, height: 460 },
});

/** The games' button: `Btn` with the GAME_ACTION gradient as its primary fill. */
export function GameBtn(props: React.ComponentProps<typeof Btn>) {
  const primary = !props.variant || props.variant === "primary";
  return (
    <Btn
      {...props}
      colors={props.colors ?? (primary ? GAME_ACTION : undefined)}
    />
  );
}
