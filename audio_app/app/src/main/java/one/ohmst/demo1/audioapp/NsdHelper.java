package one.ohmst.demo1.audioapp;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.util.Log;

// NSD = Network Service Discovery
public class NsdHelper {

  private static final String TAG = "NsdHelper";
  private static final String SERVICE_TYPE = "_http._tcp.";
  // Use _http._tcp. so browsers & tools recognize it as a web service

  private final Context context;
  private final NsdManager nsdManager;
  private WifiManager.MulticastLock multicastLock;

  private NsdManager.RegistrationListener registrationListener;

  public NsdHelper(Context context) {
    this.context = context.getApplicationContext();
    this.nsdManager = (NsdManager)context.getSystemService(Context.NSD_SERVICE);
  }

  public void start(int port, String serviceName) {
    acquireMulticastLock();
    registerService(port, serviceName);
  }

  public void stop() {
    if (nsdManager != null && registrationListener != null) {
      nsdManager.unregisterService(registrationListener);
    }
    releaseMulticastLock();
  }

  private void registerService(int port, String serviceName) {
    NsdServiceInfo serviceInfo = new NsdServiceInfo();
    serviceInfo.setServiceName(serviceName);
    serviceInfo.setServiceType(SERVICE_TYPE);
    serviceInfo.setPort(port);

    // FIXME: should emit events that rust code can recv
    registrationListener = new NsdManager.RegistrationListener() {
      @Override
      public void onServiceRegistered(NsdServiceInfo nsdServiceInfo) {
        Log.i(TAG, "Service registered: " + nsdServiceInfo.getServiceName());
      }

      @Override
      public void onRegistrationFailed(NsdServiceInfo serviceInfo,
                                       int errorCode) {
        Log.e(TAG, "Registration failed: " + errorCode);
      }

      @Override
      public void onServiceUnregistered(NsdServiceInfo serviceInfo) {
        Log.i(TAG, "Service unregistered");
      }

      @Override
      public void onUnregistrationFailed(NsdServiceInfo serviceInfo,
                                         int errorCode) {
        Log.e(TAG, "Unregistration failed: " + errorCode);
      }
    };

    nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD,
                               registrationListener);
  }

  private void acquireMulticastLock() {
    WifiManager wifi =
        (WifiManager)context.getSystemService(Context.WIFI_SERVICE);
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
}
