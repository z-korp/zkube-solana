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
import com.google.android.gms.games.Player;
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
    public static void showDailyLeaderboard(final Activity activity) {
        final String board = configured(activity, "zkube_play_games_daily_leaderboard");
        if (!signedIn || board == null) return;
        activity.runOnUiThread(() -> PlayGames.getLeaderboardsClient(activity).getLeaderboardIntent(board)
            .addOnSuccessListener(intent -> activity.startActivityForResult(intent, 9004)));
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
