package one.ohmst.demo1.ctrlapp;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.util.Log;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;

/**
 * Cordova plugin that wraps Android's NsdManager to discover mDNS/_http._tcp.
 * services by name.  The Java layer fires Cordova callback events back to JS
 * for each "found" or "lost" occurrence of the requested service.
 *
 * JS actions:
 *   startDiscovery(serviceName)  — begins discovery; keeps the callback alive
 *                                  to stream events.
 *   stopDiscovery()              — stops discovery and releases the multicast lock.
 */
public class NsdDiscoveryPlugin extends CordovaPlugin {

    private static final String TAG          = "NsdDiscoveryPlugin";
    private static final String SERVICE_TYPE = "_http._tcp.";

    private NsdManager                    nsdManager;
    private NsdManager.DiscoveryListener  discoveryListener;
    private WifiManager.MulticastLock     multicastLock;

    private CallbackContext discoveryCallback;
    private String          targetServiceName;

    // ── Cordova entry point ──────────────────────────────────────────────────

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext)
            throws JSONException {

        if ("startDiscovery".equals(action)) {
            String serviceName = args.getString(0);
            startDiscovery(serviceName, callbackContext);
            return true;
        }

        if ("stopDiscovery".equals(action)) {
            stopDiscovery();
            callbackContext.success();
            return true;
        }

        return false;
    }

    // ── Discovery ────────────────────────────────────────────────────────────

    private void startDiscovery(String serviceName, CallbackContext callbackContext) {
        // Stop any previous session first.
        if (discoveryListener != null) {
            stopDiscovery();
        }

        discoveryCallback   = callbackContext;
        targetServiceName   = serviceName;
        nsdManager          = (NsdManager) cordova.getActivity()
                                .getSystemService(Context.NSD_SERVICE);

        acquireMulticastLock();

        discoveryListener = new NsdManager.DiscoveryListener() {

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery start failed: " + errorCode);
                sendError("Discovery start failed: " + errorCode);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery stop failed: " + errorCode);
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {
                Log.i(TAG, "Discovery started; looking for \"" + targetServiceName + "\"");
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.i(TAG, "Discovery stopped");
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                String name = serviceInfo.getServiceName();
                Log.i(TAG, "Service found: " + name);

                if (!name.equals(targetServiceName)) {
                    return;
                }

                nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onServiceResolved(NsdServiceInfo resolvedInfo) {
                        InetAddress addr = resolvedInfo.getHost();
                        if (!(addr instanceof Inet4Address)) {
                            Log.w(TAG, "Skipping non-IPv4 address: " + addr.getHostAddress());
                            return;
                        }
                        int    port = resolvedInfo.getPort();
                        String host = addr.getHostAddress();
                        Log.i(TAG, "Resolved: " + host + ":" + port);
                        sendEvent("found", name, host, port);
                    }

                    @Override
                    public void onResolveFailed(NsdServiceInfo si, int errorCode) {
                        Log.e(TAG, "Resolve failed: " + errorCode);
                        sendError("Resolve failed: " + errorCode);
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                String name = serviceInfo.getServiceName();
                Log.w(TAG, "Service lost: " + name);
                if (name.equals(targetServiceName)) {
                    sendEvent("lost", name, "", 0);
                }
            }
        };

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
    }

    private void stopDiscovery() {
        if (discoveryListener != null && nsdManager != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception e) {
                Log.e(TAG, "Error stopping discovery: " + e.getMessage());
            }
            discoveryListener = null;
        }
        releaseMulticastLock();
    }

    // ── Callback helpers ─────────────────────────────────────────────────────

    private void sendEvent(String type, String service, String host, int port) {
        if (discoveryCallback == null) return;
        try {
            JSONObject ev = new JSONObject();
            ev.put("type",    type);
            ev.put("service", service);
            ev.put("host",    host);
            ev.put("port",    port);

            PluginResult result = new PluginResult(PluginResult.Status.OK, ev);
            result.setKeepCallback(true);   // keep alive for future events
            discoveryCallback.sendPluginResult(result);
        } catch (JSONException e) {
            Log.e(TAG, "JSON error: " + e.getMessage());
        }
    }

    private void sendError(String message) {
        if (discoveryCallback == null) return;
        PluginResult result = new PluginResult(PluginResult.Status.ERROR, message);
        result.setKeepCallback(true);
        discoveryCallback.sendPluginResult(result);
    }

    // ── Multicast lock ───────────────────────────────────────────────────────

    private void acquireMulticastLock() {
        WifiManager wifi = (WifiManager) cordova.getActivity()
                .getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("nsd_multicast_lock");
            multicastLock.setReferenceCounted(true);
            multicastLock.acquire();
            Log.i(TAG, "Multicast lock acquired");
        }
    }

    private void releaseMulticastLock() {
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
            Log.i(TAG, "Multicast lock released");
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onDestroy() {
        stopDiscovery();
        super.onDestroy();
    }
}
