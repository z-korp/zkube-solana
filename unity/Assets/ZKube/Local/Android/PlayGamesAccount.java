package com.zkorp.zkube.store;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.util.Base64;
import com.google.android.gms.common.images.ImageManager;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;
import com.google.android.gms.games.LeaderboardsClient;
import com.google.android.gms.games.Player;
import com.google.android.gms.games.leaderboard.LeaderboardScoreBuffer;
import com.google.android.gms.games.leaderboard.LeaderboardVariant;
import java.nio.ByteBuffer;

// The Play Games player account behind the Realms profile: after the
// platform's automatic sign-in, its display name and avatar. The listener
// hears once; a player who is signed out, refused or has no Play Games
// reports no account, and the game plays on without one.
public final class PlayGamesAccount {
    public interface Listener {
        // The display name and the avatar's pixels (see pixels), or null without one.
        void signedIn(String name, String avatar);
        void unavailable(String reason);
    }
    // Today's top of the Daily leaderboard, heard once: its raw score, or none.
    public interface TopListener {
        void top(long score);
        void none(String reason);
    }

    // Whether the platform's leaderboard screen opened, heard once.
    public interface OpenListener {
        void opened();
        void failed(String reason);
    }

    private PlayGamesAccount() {}

    // The build writes these from unity/toolchain.json once the owner has a Play
    // Games project and its leaderboard; without them there is no account and
    // no leaderboard.
    private static String configured(Activity activity, String name) {
        int id = activity.getResources().getIdentifier(name, "string", activity.getPackageName());
        String value = id == 0 ? null : activity.getString(id);
        return value == null || value.isEmpty() ? null : value;
    }
    private static boolean signedIn;

    public static boolean hasDailyLeaderboard(Activity activity) {
        return signedIn && configured(activity, "zkube_play_games_daily_leaderboard") != null;
    }

    // A finished Daily's score; Play Games keeps the player's best per day, week and all time.
    public static void submitDailyScore(final Activity activity, final long score) {
        final String board = configured(activity, "zkube_play_games_daily_leaderboard");
        if (!signedIn || board == null) return;
        activity.runOnUiThread(() -> PlayGames.getLeaderboardsClient(activity).submitScore(board, score));
    }

    // The platform's own leaderboard screen, with its daily, weekly and all-time tabs.
    public static void showDailyLeaderboard(final Activity activity, final OpenListener listener) {
        final String board = configured(activity, "zkube_play_games_daily_leaderboard");
        if (!signedIn || board == null) { listener.failed("signed out"); return; }
        activity.runOnUiThread(() -> {
            try {
                PlayGames.getLeaderboardsClient(activity).getLeaderboardIntent(board).addOnCompleteListener(read -> {
                    if (!read.isSuccessful() || read.getResult() == null) {
                        Exception error = read.getException();
                        listener.failed(error == null ? "unavailable" : error.getClass().getSimpleName());
                        return;
                    }
                    try { activity.startActivityForResult(read.getResult(), 9004); listener.opened(); }
                    catch (RuntimeException error) { listener.failed(error.getClass().getSimpleName()); }
                });
            } catch (RuntimeException error) {
                listener.failed(error.getClass().getSimpleName());
            }
        });
    }

    // The first public score of today's Daily leaderboard, read once.
    public static void dailyTop(final Activity activity, final TopListener listener) {
        final String board = configured(activity, "zkube_play_games_daily_leaderboard");
        if (!signedIn || board == null) { listener.none("signed out"); return; }
        activity.runOnUiThread(() -> {
            try {
                PlayGames.getLeaderboardsClient(activity)
                    .loadTopScores(board, LeaderboardVariant.TIME_SPAN_DAILY, LeaderboardVariant.COLLECTION_PUBLIC, 1)
                    .addOnCompleteListener(read -> {
                        LeaderboardsClient.LeaderboardScores scores = read.isSuccessful() ? read.getResult().get() : null;
                        if (scores == null) { listener.none("unavailable"); return; }
                        LeaderboardScoreBuffer buffer = scores.getScores();
                        try {
                            if (buffer.getCount() == 0) listener.none("empty");
                            else listener.top(buffer.get(0).getRawScore());
                        } finally { scores.release(); }
                    });
            } catch (RuntimeException error) {
                listener.none(error.getClass().getSimpleName());
            }
        });
    }

    public static void signIn(final Activity activity, final Listener listener) {
        activity.runOnUiThread(() -> {
            try {
                if (configured(activity, "zkube_play_games_app_id") == null) { listener.unavailable("not configured"); return; }
                PlayGamesSdk.initialize(activity);
                PlayGames.getGamesSignInClient(activity).isAuthenticated().addOnCompleteListener(signIn -> {
                    if (!signIn.isSuccessful() || !signIn.getResult().isAuthenticated()) { listener.unavailable("signed out"); return; }
                    PlayGames.getPlayersClient(activity).getCurrentPlayer().addOnCompleteListener(current -> {
                        Player player = current.isSuccessful() ? current.getResult() : null;
                        if (player == null || player.getDisplayName() == null) { listener.unavailable("no player"); return; }
                        final String name = player.getDisplayName();
                        signedIn = true;
                        Uri icon = player.getIconImageUri();
                        if (icon == null) { listener.signedIn(name, null); return; }
                        ImageManager.create(activity).loadImage((uri, drawable, requested) -> listener.signedIn(name, pixels(drawable)), icon);
                    });
                });
            } catch (RuntimeException error) {
                listener.unavailable(error.getClass().getSimpleName());
            }
        });
    }

    // The avatar as AVATAR x AVATAR RGBA pixels, bottom row first, in base64.
    public static final int AVATAR = 96;
    private static String pixels(Drawable drawable) {
        if (drawable == null) return null;
        Bitmap bitmap = Bitmap.createBitmap(AVATAR, AVATAR, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        // Unity's textures start at the bottom row.
        canvas.scale(1, -1, AVATAR / 2f, AVATAR / 2f);
        drawable.setBounds(0, 0, AVATAR, AVATAR);
        drawable.draw(canvas);
        ByteBuffer bytes = ByteBuffer.allocate(AVATAR * AVATAR * 4);
        bitmap.copyPixelsToBuffer(bytes);
        return Base64.encodeToString(bytes.array(), Base64.NO_WRAP);
    }
}
