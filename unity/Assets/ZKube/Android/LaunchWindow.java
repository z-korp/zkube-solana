package com.zkorp.zkube.launch;

import android.app.Activity;
import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

// The launch window: the product's splash (drawable/zkube_launch, the same
// drawable as the window background) stays over Unity's surface, which is
// black until its first frame, until startup releases it once Unity has
// drawn. Registered as a provider so it is in place before the activity.
public final class LaunchWindow extends ContentProvider implements Application.ActivityLifecycleCallbacks
{
    private static View overlay;
    private static boolean released;

    @Override public boolean onCreate()
    {
        ((Application) getContext().getApplicationContext()).registerActivityLifecycleCallbacks(this);
        return true;
    }

    @Override public void onActivityStarted(Activity activity)
    {
        if (released || overlay != null) return;
        int splash = activity.getResources().getIdentifier("zkube_launch", "drawable", activity.getPackageName());
        if (splash == 0) return;
        // Over the whole window, as the window background is, so the two align.
        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        overlay = new View(activity);
        overlay.setBackgroundResource(splash);
        decor.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // Called by startup after Unity's first frame: the overlay goes and the
    // window background becomes plain, so the decoded splash is freed.
    public static void release(final Activity activity)
    {
        activity.runOnUiThread(new Runnable()
        {
            @Override public void run()
            {
                released = true;
                if (overlay != null && overlay.getParent() instanceof ViewGroup) ((ViewGroup) overlay.getParent()).removeView(overlay);
                overlay = null;
                activity.getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
            }
        });
    }

    @Override public void onActivityCreated(Activity activity, Bundle state) { }
    @Override public void onActivityResumed(Activity activity) { }
    @Override public void onActivityPaused(Activity activity) { }
    @Override public void onActivityStopped(Activity activity) { }
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
    @Override public void onActivityDestroyed(Activity activity) { if (overlay != null && overlay.getContext() == activity) overlay = null; }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
