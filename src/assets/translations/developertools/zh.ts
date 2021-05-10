export const zh = {

    'developertools': {
        // Pages
        'dev-toolbox': '开发者工具箱',
        'my-apps': '我的应用',
        'no-apps': '没有应用',
        'no-apps-available': '没有可用的应用程序',
        'new-app': '新建应用',
        'provide-name': '请提供您的应用名称',
        'provide-mnemonic': '请提供现有的应用程序 DID 助记词，否则请创建新的助记词',
        'create-new-app': '创建新的应用',
        'create-app-message': '创建一个新的应用程序意味着为其创建一个新的永久 DID。必须仔细保存此 DID，因为这是将来升级应用程序的唯一方法。要了解如何构建应用程序，请访问https://developer.elastos.org',
        'app-name': '应用名称',
        'create-did': '创建一个新的 DID',
        'import-did': ' 导入已有的 DID',
        'existing-app-did-mnemonic': '现有的应用程序 DID 助记词',
        'mnemonic-passphrase': '助记词密码',
        'if-any': '(如果有的话)',
        'create-app': '创建应用',
        'app-created': '应用已创建!',
        'save-mnemonic': '请仔细保存您的助记词:',
        'manage-app': '管理应用',
        'generic-app-info': '通用的应用程序信息',
        'app-identity-status': '应用程序身份状态',
        'app-did-published?': '应用 DID 是否已经发布?',
        'dev-did-published?': '开发者 DID 是否已经发布?',
        'app-did-copied': '应用程序 DID 已经复制到剪切板',
        'checking': '正在检查...',
        'yes-published': '是的 - 已经发布成功',
        'no-published': '请发布',
        'app-attached-to-dev': '您的应用程序是否已经绑定到您的开发者?',
        'dev-did': '开发者 DID',
        'native-redirect-url': '本地重定向 URL',
        'native-callback-url': ' 本地回调 URL',
        'native-scheme': '本地Scheme',
        'publish-app-did': '发布应用的 DID',
        'up-to-date': '已更新到最新，无需发布',
        'different-did': '与当前登录的用户不同-请发布以进行更新',
        'uploading-icon': '正在将应用图标上传到开发人员的 hive vault，请稍候...',

        // Placeholders
        'redirecturl-placeholder': 'Set your intents redirect url here if any',
        'nativecustomscheme-placeholder': 'Set your custom scheme here if any',
        'nativecallbackurl-placeholder': 'Set your intents callback url here if any',

        // Components
        'appIdentityHelpMessage': 'Your application identifier on the Elastos DID chain is independant from any publication or platform such as Elastos Essentials or native Android/iOS. It is only a way to proove ownerships, but this is a mandatory step to start with.',
        'nativeRedirectUrlHelpMessage': 'Native applications need to save their intent scheme base url in their public DID document, in order to secure inter application communications.  https://elastosapp.mysite.org. Redirect URLs send native intent on mobile devices. Used by native mobile apps.',
        'nativeCustomSchemeHelpMessage': 'Native applications (android) should provide a short custom scheme (ex: myapp) that are used for example by trinity native to send intent responses. For trinity native, this custom name must match the one configured in trinitynative.json.',
        'nativeCallbackUrlHelpMessage': 'Native applications need to save their intent scheme base url in their public DID document, in order to secure inter application communications. Ex: https://elastosapp.mysite.org. Callback URLs send HTTP POST requests to a remote HTTP server. Used by websites.',
        'help-message': '应用程序 DID 存储密码是用于访问创建的应用程序配置文件的普通密码。确保安全保存此密码',
        'help-message2': '如果您已经创建了一个应用程序，则可以使用其现有的 DID 助记词来创建另一个应用程序配置文件',
        'help-message3': '仅用于高级用途，仅当您要使用钱包的密码短语以增强安全性时才需要此助记词',
        'delete-app-msg': '为了恢复此应用程序以供将来访问和更新，您必须创建一个具有相同助记词的新应用程序'
    }

};
