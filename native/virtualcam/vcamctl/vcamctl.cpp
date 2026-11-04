// vcamctl: registers or removes the AI Virtual Camera device.
// STATUS: skeleton. Not built, not run. Verify every call against the current SDK headers
// (mfvirtualcamera.h, Windows 11 SDK 10.0.22000 or later) before relying on it.
//
// Usage: vcamctl install | remove

#include <windows.h>
#include <wrl/client.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>
#include <cstdio>
#include <string>

using Microsoft::WRL::ComPtr;

// CLSID of the media source COM class in avc_mediasource.dll (to be defined when that DLL exists).
static const wchar_t* kSourceClsid = L"{00000000-0000-0000-0000-000000000000}";
static const wchar_t* kFriendlyName = L"AI Virtual Camera";

static HRESULT CreateCamera(ComPtr<IMFVirtualCamera>& vcam) {
    return MFCreateVirtualCamera(
        MFVirtualCameraType_SoftwareCameraSource,
        MFVirtualCameraLifetime_System,      // persists across reboots until removed
        MFVirtualCameraAccess_AllUsers,      // may require elevation; verify
        kFriendlyName, kSourceClsid, nullptr, 0, &vcam);
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { std::fwprintf(stderr, L"usage: vcamctl install|remove\n"); return 2; }
    const std::wstring cmd = argv[1];

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) return 1;
    hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) { CoUninitialize(); return 1; }

    ComPtr<IMFVirtualCamera> vcam;
    hr = CreateCamera(vcam);
    if (SUCCEEDED(hr)) {
        if (cmd == L"install")      hr = vcam->Start(nullptr);
        else if (cmd == L"remove")  hr = vcam->Remove();   // idempotent from the installer's point of view
        else { std::fwprintf(stderr, L"unknown command\n"); hr = E_INVALIDARG; }
    }

    if (FAILED(hr)) std::fwprintf(stderr, L"vcamctl %ls failed: 0x%08X\n", cmd.c_str(), static_cast<unsigned>(hr));
    else            std::fwprintf(stdout, L"vcamctl %ls ok\n", cmd.c_str());

    vcam.Reset();
    MFShutdown();
    CoUninitialize();
    return SUCCEEDED(hr) ? 0 : 1;
}
