import { readFile, readdirSync, statSync, writeFile } from 'fs'
import { join } from 'path'
import { init } from 'license-checker';
import { exit } from 'process';

export enum ArgsEnum {
  a = 'allowOnly',
  t = 'target',
  e = 'excluded',
  c = 'ci',
  d = 'direct'
}

export type CliArguments = Record<ArgsEnum, string>

export const argDefaults: CliArguments = {
  allowOnly: '',
  target: '',
  excluded: '',
  ci: '',
  direct: 'true'
}

export const argDescriptions: CliArguments = {
  allowOnly: 'text file with list of whitelisted licenses',
  target: 'output filename for json',
  excluded: 'packages to exclude',
  ci: 'if true then check created file against existing file',
  direct: 'if true then only check directly used dependencies'
}

const getAllPackageDirs = (dirPath, arrayOfFiles = []) => {
  readdirSync(dirPath).forEach((file) => {
    let isDirectory = false;
    try {
      isDirectory = statSync(dirPath + "/" + file).isDirectory()
    } catch (e) {
      return arrayOfFiles
    }
    if (file !== 'node_modules' && isDirectory) {
      arrayOfFiles = getAllPackageDirs(dirPath + "/" + file, arrayOfFiles)
    } else if (file === 'package.json') {
      arrayOfFiles.push(dirPath)
    }
  })

  return arrayOfFiles
}


const loadFile = (path) => new Promise<string>((resolve, reject) => {
  readFile(path, 'utf8', (err, data) => {
    if (err) {
      return reject(err)
    }
    resolve(data)
  })
})

const parseErrors = (packages, whiteListRegex = [], excluded = []) => Object.entries(packages).reduce((withErrors, [packageWithVersion, { licenses }]: [string, any]) => {
  const packageName = packageWithVersion.split('@').reverse()[1]
  if (!excluded.includes(packageName) && whiteListRegex.every(regex => !regex.test(licenses))) {
    withErrors.push(`(${packageWithVersion}) Invalid License: ${licenses}`)
  }
  return withErrors
}, [])

const relativePaths = (packages: Record<string, any>, root: string, base: string) => Object.entries(
  packages
).reduce((
  updated, [key, value]
) => ({ ...updated, [key]: typeof value === 'string' ? value.replace(root, base) : relativePaths(value, root, base) }), [])


export async function recursivelyCheckLicenses(cliArguments: CliArguments): Promise<{ message: string }> {
  const root = process.cwd()
  const base = root.split('/').pop()
  const whiteList = cliArguments.allowOnly ? JSON.parse(await loadFile(join(root, cliArguments.allowOnly))) : []
  const excluded = cliArguments.excluded ? JSON.parse(await loadFile(join(root, cliArguments.excluded))) : []
  const direct = cliArguments.direct === 'false' ? Infinity : 0;
  const out = join(root, cliArguments.target || 'package-license.json')
  const whiteListRegEx = whiteList.map(license => new RegExp(license, 'i'))
  const ciMode = !!cliArguments.ci

  const packageDirs = getAllPackageDirs(root)

  const results = await packageDirs.reduce(async (_combined, start) => new Promise(async (resolve) => {
    const combined = await _combined;

    init({ start, direct }, (err, packages) => {
      const packageErrors = whiteList.length && parseErrors(packages, whiteListRegEx, excluded)
      if (err) {
        console.error(`Some error occurred while processing ${start}`)
        console.error(err)
        exit(1)
      } else if (packageErrors.length) {
        packageErrors.forEach(error => console.error(error))
        exit(1)
      } else {
        combined[join(start.replace(root, ''), '/')] = relativePaths(packages, root, base)
        resolve(combined)
      }
    })

  }), Promise.resolve({}));

  await new Promise<void>(async (resolve) => {
    const resultJSON = JSON.stringify(results, null, 4)
    if (ciMode) {
      const existing = await loadFile(out)
      if (existing === resultJSON) {
        console.log('Licenses unchanged')
      } else {
        console.error('Licenses changed, need to run recursively-check-licenses before merging')
        exit(1)
      }

    } else {
      writeFile(out, resultJSON, (err) => {
        if (err) {
          console.error(`some error when writing to ${out}`)
          exit(1)
        }
        resolve()
      })
    }
  })

  return { message: `Saved license info to ${out}` }
}
